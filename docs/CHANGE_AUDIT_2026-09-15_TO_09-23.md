# Change audit: September 15 – 23, 2026

Net changes merged to `main` in the window ending 2026-09-23, picking up where
the [September 12 – 15 audit](./CHANGE_AUDIT_2026-09-12_TO_09-15.md) stopped at
`4c291192d` (2026-09-15 22:30 UTC, PR #2594). Written against `da7d28479`
(PR #2650, 2026-09-24 01:26 UTC).

**40 pull requests (#2595 – #2650), 51 non-merge commits.** Four schema
migrations, head `5a70c5dcd138`. **Two routes added, none retired** — the first
new addresses since the August 31 – September 6 window.

Of the 40, **nine change behaviour**, four are dependency updates, one repairs
the screenshot seeder, and the rest are documentation: the previous audit's own
three PRs, eleven security-review passes and the tracker records that followed
them. Twenty-six of the 51 commits are security-review work.

The window's theme is **records that say what really happened**. An applicant
leaves a meeting stage when the department has settled who attended, not when
they tapped a kiosk; an inventory item knows whether it has a label; a form
stops storing an answer to a question the submitter could not see; and the
pipeline header counts the applicants the table is showing. The one new
feature — **suggestion boxes** — is built on the same instinct: anonymity is
something the database does not store, rather than something the screen hides.

Companion operator lesson: the **September 15–23** section of
[`training/20-september-2026-release-changes.md`](./training/20-september-2026-release-changes.md#september-1523-2026-changes).
Wiki handoff:
[`Recent-Changes-2026-09-15-to-09-23`](../wiki/Recent-Changes-2026-09-15-to-09-23.md).
Media disposition — which screenshots must be created, which replaced — is in
[Documentation and media disposition](#documentation-and-media-disposition)
below.

## Read this first

Five changes alter what somebody sees or may do without anyone asking for it.

1. **A meeting stage that names its event now binds the coordinator's own
   Advance, and waits for the event to be finalized.** Three PRs in two days
   moved this gate, and the last one is the rule:
   - [#2595](https://github.com/thegspiro/the-logbook/pull/2595) held **Bulk
     Advance** to the attendance gate, leaving a single **Advance** exempt.
   - [#2613](https://github.com/thegspiro/the-logbook/pull/2613) (first commit)
     replaced "who is advancing" with "what the stage asks for": a stage that
     names its event (Auto-Link Event Type or a pinned event) refuses
     **every** path — Advance, drag, bulk, automatic — until attendance exists;
     a stage naming none takes the coordinator's word on every path. It also
     stopped attendance from **before the application was opened** counting,
     which closed the case where the kiosk sign-in that created a prospect
     satisfied a later "attend a business meeting" stage.
   - [#2613](https://github.com/thegspiro/the-logbook/pull/2613) (second
     commit) moved the trigger from **check-in** to **finalize**. The applicant
     advances when the organizer runs End Event, records an actual end time or
     presses Finalize Attendance; an event nobody finalizes settles after
     `PIPELINE_ATTENDANCE_SETTLE_DAYS` (default 7), picked up by a new nightly
     `prospect_attendance_advance` task at 05:30.

   **Operators should tell event organizers to finalize** — it is now what
   moves applicants along — and look at who is parked on an event-naming
   meeting stage having attended unrecorded, because those applicants will now
   be refused on Advance. Both UPGRADING entries from the window are in place
   and cross-reference each other as superseded.

2. **Every member gets a new sidebar item, and five seeded positions a new
   permission.** Suggestion boxes ([#2649](https://github.com/thegspiro/the-logbook/pull/2649))
   add **Suggestions** for everyone and **Suggestion Boxes** under
   Administration → Forms & Comms. Migration `394600cbfae2` writes
   `suggestions.manage` onto the system Fire Chief, Deputy Chief, Assistant
   Chief, President and Communications Officer rows. **That grant configures
   boxes and reads nothing** — only a box's named reviewers read it — so it
   discloses no submission. It does make the Administration section visible to
   its holder, which for those five changes nothing.

3. **Every inventory item reads "Needs a label" on the first load after
   upgrading** ([#2650](https://github.com/thegspiro/the-logbook/pull/2650)).
   The new `label_printed_at` column has no backfill because no history
   existed. A department whose stock is already labelled can catch the records
   up without printing; the recipe is in [`UPGRADING.md`](./UPGRADING.md).

4. **A form with a conditional required question can be submitted again**
   ([#2647](https://github.com/thegspiro/the-logbook/pull/2647)). The server
   enforced **required** on fields the renderer had hidden, so "Previous EMT
   experience" (shown only for EMT) made the form unsubmittable for everyone
   else, surfacing as **LB-API-400**. Hidden answers are now also discarded at
   submission. Older submissions may hold such answers; an optional,
   dry-run-by-default script clears them
   ([#2648](https://github.com/thegspiro/the-logbook/pull/2648)).

5. **The installed app's icon is the department's logo**
   ([#2636](https://github.com/thegspiro/the-logbook/pull/2636)), rendered by
   the server into every manifest and iOS geometry. **Already-installed apps
   keep the old icon** — neither platform revisits it — and an installation
   whose reverse proxy serves the frontend's built files off disk keeps serving
   the stock icon, because the branded ones do not exist on disk.

## Release map

| Theme                   | What changed                                                                                                                                                                                                                   | Where it is documented                                                                                                                                                                 |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Membership pipeline** | Meeting gate decided by the stage, not the caller; attendance must be settled (finalized, or 7 days old); pre-application attendance ignored; stats header counts through the list's filters and refreshes with every mutation | [`UPGRADING.md`](./UPGRADING.md), [`PROSPECTIVE_MEMBERS_MODULE.md`](./PROSPECTIVE_MEMBERS_MODULE.md), [`training/15-prospective-members.md`](./training/15-prospective-members.md)     |
| **Communications**      | Suggestion boxes: per-box reviewers, three anonymity modes, follow-up threads with an anonymous key, single-suggestion forwarding                                                                                              | [`COMMUNICATIONS_MODULE.md`](./COMMUNICATIONS_MODULE.md#suggestion-boxes-2026-09-23), [`training/07-documents-forms.md`](./training/07-documents-forms.md#suggestion-boxes-2026-09-23) |
| **Inventory**           | Select all matching (≤500) and print by filter; a scope picker on the bare print page; label-printed tracking that clears itself when the printed value changes                                                                | [`training/05-inventory.md`](./training/05-inventory.md#knowing-which-items-still-need-a-label-2026-09-23), [`LABEL_PRINTING_MODULE.md`](./LABEL_PRINTING_MODULE.md)                   |
| **Forms**               | Conditional visibility enforced server-side: hidden fields are not required and their answers are not stored; a cleanup script for older rows                                                                                  | [`FORMS_MODULE.md`](./FORMS_MODULE.md), [`backend/scripts/README.md`](../backend/scripts/README.md#clear_hidden_form_answerspy)                                                        |
| **PWA**                 | Department logo rendered into the app icons and iOS launch images; maskable icon split out; `?v=2` cache-busting                                                                                                               | [`UPGRADING.md`](./UPGRADING.md), [`KNOWN_LIMITATIONS.md`](./KNOWN_LIMITATIONS.md), [`training/10-mobile-pwa.md`](./training/10-mobile-pwa.md)                                         |
| **Medical screening**   | The Add Record dialog now states that its records attach to nobody (MS-13, flagged; interim notice only)                                                                                                                       | [`security-review/MS-09-medical-screening.md`](./security-review/MS-09-medical-screening.md), [`training/13-medical-screening.md`](./training/13-medical-screening.md)                 |
| **Dependencies**        | vitest and `@vitest/coverage-v8` to 5.0.1 together; npm and Python minor/patch groups; **PyMySQL held at 1.2.0** and **jsdom held at 30.0.1**, each with a Dependabot ignore                                                   | [`KNOWN_LIMITATIONS.md`](./KNOWN_LIMITATIONS.md#dependencies)                                                                                                                          |
| **Security review**     | Pass 6 covered Features 07 – 17 (eleven features); one finding (MS-13), zero fixes elsewhere. The rotation stopped opening a docs-only PR per merge                                                                            | [`security-review/PROGRESS.md`](./security-review/PROGRESS.md)                                                                                                                         |
| **Screenshot tooling**  | The seeder now carries an applicant through a **losing** membership vote, unblocking the Not Elected shot                                                                                                                      | [`training/SCREENSHOT_CURRENCY.md`](./training/SCREENSHOT_CURRENCY.md)                                                                                                                 |

## New URLs

| Route                              | Page                      | Gate                 | Registered in                                                             |
| ---------------------------------- | ------------------------- | -------------------- | ------------------------------------------------------------------------- |
| `/suggestions`                     | Suggestions               | Signed in            | `APPLICATION_PAGES.md`, `testingRegistry.ts`, `mobile-route-inventory.ts` |
| `/communications/suggestion-boxes` | Suggestion Box Management | `suggestions.manage` | same three                                                                |

**`/suggestions` shows a Review tab only to reviewers**, which the backend
decides per box (`GET /suggestions/review/summary`) rather than a permission.
The page reads `?tab=` and `?id=`, which is what the notification emails link
to. `/inventory/print-labels` is not new, but it now accepts `?all=1` plus the
items-list filters as well as `?ids=`, and renders a picker when given neither.

**Nothing was retired.** No bookmark breaks.

## Alembic route (upgrade data path)

| Revision       | What it does                                                                                                                                             | Reversible                                                                                                                     |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `80e2004cd691` | `suggestion_boxes`, `suggestion_box_reviewers`, `suggestions`, `suggestion_attachments`, `suggestion_messages`; each guarded on absence                  | Yes — **destructively**: drops every suggestion, attachment record and message. Files under `uploads/suggestions` stay on disk |
| `394600cbfae2` | Adds `suggestions.manage` to `is_system` positions `fire_chief`, `deputy_chief`, `assistant_chief`, `president`, `communications_officer` where absent   | Yes — removes it from the same rows, including a grant a department added by hand after upgrading                              |
| `9cb132ad83dc` | `suggestion_forwards`                                                                                                                                    | Yes — drops every forward; suggestions intact                                                                                  |
| `5a70c5dcd138` | `inventory_items.label_printed_at` (tz-aware), `label_printed_by` (FK `users.id` ON DELETE SET NULL, nullable) and `ix_inventory_items_label_printed_at` | Yes — loses only the print history                                                                                             |

**Why the grant migration may run unconditionally.**
[`docs/rules/migrations.md`](./rules/migrations.md) requires positive evidence
before _adding_ a grant to a stored position, because an unconditional add
overrides a department that removed it on purpose. That cannot apply here: the
permission did not exist before this revision, so no position editor could ever
have offered it and its absence says nothing about any department's choice. The
migration still touches only `is_system` rows and freezes its slug list rather
than importing the registry (pitfall #23).

**Why the grant migration was a separate child revision, and the forwards table
too.** Both follow the rule that a published revision is frozen: the forwarding
feature landed as a second commit on the same PR, and adding its table to the
already-written `80e2004cd691` would have edited a revision a reviewer had
already read.

**No backfill for `label_printed_at`**, deliberately: nothing recorded which
items were labelled, and inferring it would mark items as done that are not.

`DATABASE_SCHEMA.md` was regenerated in both PRs that change models.

## Permission and enforcement movements

### Granted

- **`suggestions.manage`** (new category `suggestions`) — to the three chief
  ranks and President and Communications Officer, seeded and back-filled.
  Added to `ADMIN_NAVIGATION_PERMISSIONS`, so its holder sees the
  Administration section.

### Enforcement moved onto more paths

- **Meeting-stage attendance gate** — from "automated advances only" (09-13) to
  "automated and bulk" (09-15, #2595) to "every path, when the stage names an
  event" (09-16, #2613). The only exemption left is a stage that names no
  event, which can never be graded.
- **Conditional visibility** — from renderer-only to renderer **and** server
  (`FormsService._is_field_visible`, mirroring `isFieldVisible` in
  `PublicFormPage.tsx` and `FormRenderer.tsx`). This _relaxes_ the required
  check for hidden fields and _tightens_ what is stored. An unrecognised
  operator counts as visible, so a malformed rule fails closed.

### Deliberately not gated

- **The suggestions router ignores the `communications` module flag.**
  `communications` defaults off and none of its screens honour the flag, so
  gating only this would hide suggestion boxes on almost every installation.
  Recorded in `DELIBERATELY_UNGATED` in `tests/test_module_api_gating.py`.
- **Reading a suggestion is not a permission.** It is decided per box and per
  forward in `SuggestionService`, at request time, so a reviewer position that
  changes hands changes who can read immediately.

### Tenancy notes (pitfall #14)

- `GET /pipelines/{id}/stats` gained a client-supplied `event_id`, confirmed
  in-org through `_require_org_event` before it is counted through — the same
  check `GET /prospects` makes.
- `POST /inventory/labels/mark-printed` resolves ids org-scoped and silently
  skips ids from other organizations and items with no printable value.
- Every suggestion by-id read resolves through the caller's organization and
  then through reviewer, forward or authorship membership; the admin endpoints
  take `suggestions.manage` **and** org-scope the box.

## Data-integrity notes

- **Anonymity is structural, and has accepted limits.** An anonymous
  submission stores no author, writes no audit entry, pins its timestamps (and
  the attachment file's mtime) to noon UTC of the day, and re-encodes
  screenshots to WebP, which drops EXIF; the follow-up key is stored only as a
  SHA-256 digest. What it does **not** defeat — timing correlation by someone
  with server access (access log, the reviewer email's send time, session
  activity), an unrecoverable lost key, visible screenshot content, and exact
  file `ctime` — is recorded as **Accepted** in
  [`KNOWN_LIMITATIONS.md`](./KNOWN_LIMITATIONS.md) under "Suggestion Boxes —
  What Anonymity Does and Does Not Cover".
- **The label mark clears itself.** A `before_update` listener on
  `InventoryItem` nulls both columns when the printed value changes — barcode,
  else asset tag, else serial, via the shared `printable_label_value` — which
  covers the edit form, CSV import, variant generation and the PDF's barcode
  auto-fill. Raw Core `update()` statements bypass it; none writes these
  columns today.
- **Hidden-answer cleanup errs toward keeping data.** The script removes an
  answer only when the rule hides it **and** neither the field nor its
  controller was edited after the submission; there is no rule history, so
  anything newer is listed for a person. `--apply` requires a backup file
  written owner-only and never overwritten; `--restore` will not overwrite an
  answer re-added since; audit entries name questions, never answers.
- **The pipeline header and list cannot drift.** `refreshPipelineView` is the
  only mutation refresh path (guarded by `pipelineRefreshIntegrity.test.ts`),
  the stats count through the list's `search` and `event_id` via one shared
  predicate builder, and each of the six list fetches carries a sequence number
  so a stale response is dropped whole.

## Security review

Pass 6 advanced from Feature 07 (Users & organizations) to Feature 17 (Training
core) — eleven features. Ten were zero-delta re-verifications with nothing
fixed or flagged. One produced a finding:

- **MS-13 (MED, Feature 09 Medical screening) — flagged, interim notice
  applied.** `ScreeningRecordForm`'s create dialog has no control for `user_id`
  or `prospect_id`, so every record it creates belongs to nobody and counts
  toward nobody's compliance. Wiring a picker is feature work (a new data
  source and an exactly-one-of decision), so the pass added an amber notice to
  the create dialog instead and pinned it with
  `ScreeningRecordForm.linkageNotice.test.tsx`. The underlying gap is the
  existing
  [`KNOWN_LIMITATIONS.md`](./KNOWN_LIMITATIONS.md#medical-screening--the-add-record-form-attaches-to-nobody-2026-08-08)
  entry, filed 2026-08-08 and still open.

**The rotation's bookkeeping changed** ([#2644](https://github.com/thegspiro/the-logbook/pull/2644)).
It had been opening a docs-only PR to record each feature PR's merge — eighteen
in twelve days — and each became an event the next iteration recorded, which is
how #2630 → #2632 → #2634 chained. Step 0 now reads open
`claude/security-review-*` PRs from GitHub and treats the tracker's Open PR row
as narrative, so the record rides along with the next feature PR. The same
collision the changelog freeze exists to avoid had been reproduced in
`PROGRESS.md`.

## Dependencies

- **vitest and `@vitest/coverage-v8` moved to 5.0.1 together**
  ([#2642](https://github.com/thegspiro/the-logbook/pull/2642)). Dependabot
  opened them as separate PRs and each fails alone; `main` was already skewed
  with `@vitest/ui` 5 on vitest 4.
- **PyMySQL held at 1.2.0.** 1.2.1+ replaced `escape_bytes_prefixed` with a
  string sentinel that aiomysql 0.3.2 (latest) still calls, so every BLOB write
  raised. The advisory it fixes (GHSA-x4f8-9hx9-hpp9) needs a CJK connection
  charset; this app uses `utf8mb4`. Owner decision recorded as pending in
  `KNOWN_LIMITATIONS.md`.
- **jsdom held at 30.0.1.** jsdom 30.1 breaks vitest's `URL.createObjectURL`
  shim. Test environment only.
- Dependabot minor/patch groups (#2641, #2645, #2646).

`CLAUDE.md`'s tech-stack versions and the wiki's two stack tables were brought
up to the manifest in this pass: Vitest 5.0, Vite 8.3, React 19.3,
react-router 8.4, Zod 4.6, react-hook-form 7.88, Axios 1.20. All but Vitest
predate the window; they were stale, and were found while checking it.

## Documentation and media disposition

### What the window's own PRs already documented

Three substantive PRs carried their own operator notes, and they were
accurate: #2595 and #2613 in `UPGRADING.md` (with the older entry marked
superseded), #2613 in `.env.example.full`, #2636 in `UPGRADING.md` and
`KNOWN_LIMITATIONS.md`, #2649 in `APPLICATION_PAGES.md` and
`KNOWN_LIMITATIONS.md`, #2648 in `backend/scripts/README.md`. **Nothing else
was touched by them**, and six reference or training documents described
pre-window behaviour.

### Corrected in this pass

| Document                                                                                                                                                                                                                                                  | What was stale or wrong                                                                                                                                                                                                                       |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`training/15-prospective-members.md`](./training/15-prospective-members.md)                                                                                                                                                                              | Said a meeting stage advances "when they are checked in", that **Advance** "is not gated on the attendance record", and to "use Advance" when attendance was unrecorded — **all three false** after #2613. Rewritten; stats-header note added |
| [`PROSPECTIVE_MEMBERS_MODULE.md`](./PROSPECTIVE_MEMBERS_MODULE.md)                                                                                                                                                                                        | Gate table read "meeting — No, automatic advances only". **The stats endpoint path was wrong** (`/prospective-members/stats` does not exist; it is `/pipelines/{id}/stats`) — pre-existing, fixed here                                        |
| [`training/05-inventory.md`](./training/05-inventory.md)                                                                                                                                                                                                  | Label printing described hand-ticked selection only. **Step 5 listed a Send to Printer button the inventory page does not have** — direct printing exists only on the shared label pages. Pre-existing; corrected with a dated note           |
| [`wiki/Module-Inventory.md`](../wiki/Module-Inventory.md)                                                                                                                                                                                                 | `/inventory/print-labels` gated "Authenticated"; it is `inventory.manage`. Pre-existing                                                                                                                                                       |
| [`training/04-events-meetings.md`](./training/04-events-meetings.md)                                                                                                                                                                                      | Finalizing described without its new consequence for applicants                                                                                                                                                                               |
| [`training/10-mobile-pwa.md`](./training/10-mobile-pwa.md)                                                                                                                                                                                                | Claimed "the Logbook icon (or your department's logo)" before the logo was ever used                                                                                                                                                          |
| [`training/07-documents-forms.md`](./training/07-documents-forms.md)                                                                                                                                                                                      | Nothing on suggestion boxes; conditional visibility described as screen-only                                                                                                                                                                  |
| [`training/13-medical-screening.md`](./training/13-medical-screening.md)                                                                                                                                                                                  | No mention of the new notice                                                                                                                                                                                                                  |
| [`training/16-integrations.md`](./training/16-integrations.md)                                                                                                                                                                                            | The legacy `action` + `schedule_meeting` Cal.com fix                                                                                                                                                                                          |
| [`COMMUNICATIONS_MODULE.md`](./COMMUNICATIONS_MODULE.md), [`FORMS_MODULE.md`](./FORMS_MODULE.md), [`LABEL_PRINTING_MODULE.md`](./LABEL_PRINTING_MODULE.md), [`ROLE_SYSTEM_README.md`](../ROLE_SYSTEM_README.md), wiki Communications / Events / Inventory | Engineering sections for each feature                                                                                                                                                                                                         |
| [`UPGRADING.md`](./UPGRADING.md)                                                                                                                                                                                                                          | Three entries added: label tracking, suggestion boxes and the grant, hidden form answers                                                                                                                                                      |

**`CHANGELOG.md` was not edited.** It has been closed to per-change entries
since 2026-09-08 (see `CLAUDE.md`); this audit, the PRs and `UPGRADING.md`
carry the record instead.

### Screenshots

Full per-image queue in
[`training/SCREENSHOT_CURRENCY.md`](./training/SCREENSHOT_CURRENCY.md);
counts regenerated into
[`training/SCREENSHOT_STATUS.md`](./training/SCREENSHOT_STATUS.md)
(**543 captured, 46 remaining** — this pass queued eleven, and ten of them were captured on 2026-09-24; only the installed-app icon, which needs a real device, remains).

| Image area                                                    | Disposition | Guide |
| ------------------------------------------------------------- | ----------- | ----- |
| Sidebar **Suggestions** item + **Submit** tab                 | **NEW**     | 20    |
| **New suggestion box** dialog                                 | **NEW**     | 07    |
| **Submit anonymously** with the screenshot warning            | **NEW**     | 07    |
| **Save your follow-up key** receipt (demo key only)           | **NEW**     | 07    |
| **Review** tab with a submission open                         | **NEW**     | 07    |
| Items list **Needs a Label** + **All N matching selected**    | **NEW**     | 05    |
| Label page **Print barcode labels** picker                    | **NEW**     | 05    |
| "Did the labels print correctly?" prompt                      | **NEW**     | 05    |
| Home screen with the department-logo icon                     | **NEW**     | 10    |
| **Add Record** with the MS-13 notice                          | **NEW**     | 13    |
| Applicant drawer on an event-naming Meeting stage             | **NEW**     | 20    |
| `00-15-sidebar-member`, `00-16-sidebar-admin`                 | **REPLACE** | 00    |
| `05-47-items-filter-bar` (and 05-01/02/03 incidentally)       | **REPLACE** | 05    |
| `05-06`, `05-56`, `05-61`, `05-67`, `10-16` (Basic Info card) | **REPLACE** | 05/10 |
| `15-05`, `15-14` (drawer)                                     | **CHECK**   | 15    |
| `15-12-pipeline-stats`                                        | NO CHANGE   | 15    |

**Suggestion boxes are seeded** _(2026-09-24)_: three boxes and four
submissions covering every state the guides describe, reviewed by the
Secretary position (`okittredge`, the manifest's `auth: "secretary"` account).
All five suggestion-box shots are captured (`07-14` – `07-17`, `20-13`); none
of them writes anything, and the follow-up-key receipt shows a route-mocked
`DEMO-KEY-…` rather than a real credential. **The
home-screen icon cannot be produced by the capture harness** — it needs a real
or emulated device install.

### YouTube script beats

Determinations were made by **reading the script files**. Full disposition in
[`youtube-scripts/SCRIPT_CURRENCY.md`](./youtube-scripts/SCRIPT_CURRENCY.md).

- **04 — Fire Chief.** Two **Wrong**: the daily checklist's "the system
  automatically updates participation records" now needs "then finalize", and
  the Convert-gate `[SCREEN]` direction asked for **Convert** beside a Not
  Elected panel, which the 09-22 screenshot capture proved can never share a
  frame. One **Incomplete**: a new meeting-stage beat. Lead any re-record with
  "tell your organizers to finalize".
- **06 — Member.** Mobile Access gains the logo icon and the reinstall
  caveat.
- **07 — Secretary.** Forms beat gains the conditional-required fix.
- **03 — IT Manager.** Addition: the branded icon and the reverse-proxy
  requirement.
- **08 — Shorts.** Three new: 8AR (suggestion box), 8AS (label a storeroom),
  8AT (applicants move at finalize).
- **07 — Secretary** gained **Chapter 7: Suggestion Boxes** (17:35 – 20:35),
  added 2026-09-24 at the owner's request: who can set boxes up (not the
  Secretary by default), the three anonymity modes, the member's view and
  follow-up key, and reviewing and forwarding.

## Verification

```bash
cd backend && python scripts/validate_migrations.py   # head = 5a70c5dcd138
python3 scripts/check_route_permissions.py --strict   # routes vs APPLICATION_PAGES.md
python3 scripts/check_endpoint_permissions.py         # endpoints vs docstrings
python3 scripts/check_docs_links.py                   # cross-doc links
python3 scripts/screenshots/status_report.py          # screenshot coverage
cd backend && python scripts/generate_schema_docs.py  # DATABASE_SCHEMA.md must not change
```

Run against `da7d28479` plus this pass's documentation while writing this
audit: migration head `5a70c5dcd138`, single head; 230 routes with 0 errors and
0 warnings (17 redirects skipped); 1,498 documented route handlers with 0 errors
and 0 warnings; 362 Markdown files with 0 broken links, anchors included; 533
screenshots captured with 56 remaining after this pass's eleven placeholders (543 and 46 once ten of them were captured on 2026-09-24);
`DATABASE_SCHEMA.md` regenerated with no diff; the 141 documentation-tooling
tests under `scripts/` pass.
