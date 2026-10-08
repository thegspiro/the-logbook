# Change audit: October 7 – 8, 2026

Net changes merged to `main` in the 25 hours ending 2026-10-08 ~09:00 ET,
written against `832609f7` (PR #2995). It picks up where the
[October 6 – 7 audit](./CHANGE_AUDIT_2026-10-06_TO_10-07.md) stopped, at
`021fecc6` (PR #2980). Sixteen pull requests merged (#2981 – #2996). Six
carry user-visible work: **#2985** and **#2987** (training-provider imports and
training records), **#2989** (Add Member fix), **#2991** (finance requests),
**#2992** and **#2993** and **#2995** (dark-mode menus, apparatus guidance,
member visibility layout). Eight are security-review records (#2981, #2983,
#2984, #2986, #2988, #2990, #2994, #2996), two of which also fixed code (#2994,
#2996). #2982 was the previous documentation pass.

Wiki handoff:
[`Recent-Changes-2026-10-07-to-10-08`](../wiki/Recent-Changes-2026-10-07-to-10-08.md).

**Migration head.** Five new revisions follow the previous window's head
`8c4f2a6e1d93` as one chain (see _Migration route_). Run `alembic heads`: it must
report a single head, `7db20aa49329`.

## Read this first

1. **Every member can now raise their own finance requests** (#2991, new
   permission `finance.request`). Migration `7db20aa49329` grants it to each
   department's seeded **Member** position, so on upgrade **every member** can
   create, edit, submit and (for a draft purchase request) withdraw their own
   purchase requests, expense reports and check requests, and sees only their own.
   Another member's record is a 404. Approval chains still apply and nobody can
   approve or pay their own. To withdraw it, remove `finance.request` from the
   Member position. `docs/UPGRADING.md` (2026-10-07) carries the detail.
2. **Target Solutions syncs and uploads now credit members automatically**
   (owner decision). Matched completions become training records at sync or
   upload time; unmatched ones wait under **Imports**. Vector Solutions, Lexipol,
   iAmResponding and Custom API **keep the officer's review step** until each is
   reviewed (`AUTO_CREDIT_PROVIDERS` in `external_training_service.py` is the list
   a provider joins). The same import path now serves sync, upload and the
   **Import** / **Bulk Import** buttons, which used to ignore the category and
   credit hours the officer chose.
3. **Officers can void or edit a member's training record, and the member is
   told** (#2987). A void needs a reason, which the member sees on Training History
   and My Training and receives by bell and email. A void is final (it cannot be
   edited back into credit) and it now also removes a qualification the record
   granted. See _Training records_.
4. **Three requirement templates changed type.** HIPAA, Bloodborne Pathogens and
   Hazmat now create **Courses** requirements; the old "hours filtered by type"
   form let any CAPCE hour of that type satisfy a HIPAA refresher. **Existing
   requirements are not rewritten**; a warning appears on the card of an hours
   requirement carrying one of those codes with no category or course scope.
   Training officers should open **Training Admin › Requirements** and fix them.
5. **A migration marks duplicate staged imports.** `9bb4af123ebc` makes
   `(provider_id, external_record_id)` unique. Existing duplicates are settled
   first and nothing is deleted: the kept row is the imported one, else the
   earliest; others get `#dup:<id>` appended and (if never imported) status
   `duplicate`, leaving the Imports queue.

## What changed, by area

### Training provider imports (Target Solutions first)

| Change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Where it shows                                                 |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------- |
| **Upload Report** — a Target Solutions provider card takes the completions-report CSV with no key or secret (`POST /training/external/providers/{id}/upload-report`, `training.manage`, 25 MB, `.csv`). Same parser as sync; recorded in sync history as "upload". Sync and upload take turns on the provider row, so a completion is never recorded twice.                                                                                                                                                                                | **Integrations › Training providers**, provider card           |
| **Live report accepted.** The report opens with a title block above the header row; the parser now finds the header row instead of rejecting every real report. A failed report request says what Target Solutions actually returned.                                                                                                                                                                                                                                                                                                      | Sync result and error                                          |
| **Members matched by Employee ID** when email finds nobody (Target Solutions only; membership number, same department, live members, one candidate only).                                                                                                                                                                                                                                                                                                                                                                                  | Unmatched count on Imports                                     |
| **Credit hours come from Duration (hours)**, not Time Spent In Course. All import paths store `credit_hours`.                                                                                                                                                                                                                                                                                                                                                                                                                              | Training records                                               |
| **Admin items are policy acknowledgments.** New training type `policy_acknowledgment` for Target Solutions "Admin" assignments (migration `6cf89b44dc08` widens the type ENUM on five tables). A second acknowledgment of one item by one member on one day is staged as a duplicate.                                                                                                                                                                                                                                                      | Requirement, Course Library and Historical Import type pickers |
| **Course mappings.** Provider course ids map to library courses (`external_course_mappings`, migration `95dbdfb6591d`), so a requirement linked to the library course is met by any mapped version. A **Courses** tab under Mappings lists each course with its completion count and a suggested library match (one-click **Map**, never applied unasked). Mapping back-fills records already imported; unmapping reverses it; both are audit-logged. Training officers get one **New Course Version to Map** email per resembling course. | **Integrations › Training providers › Mappings › Courses**     |
| **Category order** for an imported record: the officer's choice, provider category mapping, the mapped course's first active category, the bulk default, then the provider default.                                                                                                                                                                                                                                                                                                                                                        | Training records                                               |
| **Provider credentials redacted from failure tracebacks** (query-string auth).                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Logs and Sentry only                                           |

### Training records

- **Void and Edit** on the member's Training History page (`training.manage`).
  Void requires a reason, stored as `void_reason` with `voided_at` / `voided_by`
  (migration `26ca07c56d0f`, three nullable columns). An edit that changes a value
  the member sees sends a bell notice and email listing each change. The email is
  a new **required** kind, _Changes to your training record_, with two editable
  templates (_Training Record Voided_, _Training Record Updated_).
- A void withdraws a qualification the record granted (the removal was previously
  flushed but never committed). A provider-imported record keeps its provider id,
  so a later sync links to the voided record instead of crediting it again.
- **Requirement guidance.** The training guide now warns against Hours
  requirements for a required topic, with a type-by-rule table and a fix-up
  checklist; the integrations and programs guides point to it.

### Finance

- Member request pages (#2991): list and detail routes open to `finance.request`,
  `finance.view` or `finance.manage`; New/Edit to `finance.request` or
  `finance.manage`. A member's lists read **My Purchase Requests / My Expense
  Reports / My Check Requests**. Order, receive, pay, issue and void stay with
  `finance.manage`; Void is offered only on an issued check.
- Forms read fiscal years and budget lines from new `GET /finance/budgets/options`
  and `GET /finance/fiscal-years/options` (label plus amount remaining), so a
  member picks "Training — $1,250.00 remaining" without budget access.
- A **Finance** navigation group (side and top bar), each entry gated by its route.
- Expense-report org-wide view stays manage-only (FIN-5).

### Apparatus (#2993, frontend only)

- The row wrench opens the **Maintenance** tab (it was a second "View"); the row
  **Archive** button is gone, because archiving needs the disposal form on the
  apparatus page.
- An empty fleet reads **No apparatus yet** with a sentence on what a record is
  for; a search or filter with no match still reads **No Apparatus Found**.
- Add form: "Only the fields marked * are needed to start." The NFPA checkbox says
  tracking is per vehicle and off by default, even when the department switch is
  on. Fuel type reads **CNG**, not "Cng".
- Equipment tab explains that crew shift checks come from a separately built
  checklist and links to **Build equipment checklists** for `inventory.check_manage`.
- Maintenance form: states which date to use and that the **Next Due** fields stay
  on the record and do **not** add to Maintenance Due.
- **Badge contrast.** Status and type colours tint the badge and icon; the text
  uses the theme's primary colour. (Seeded green "In Service" measured 1.95:1 and
  the red "Engine" badge 3.98:1, below 4.5:1.)

### Other UI

- **Member Visibility Settings** (My Training, officers) is laid out as bordered
  group cards in two columns, with matching headings. While a change is unsaved, a
  bar pinned to the bottom of the viewport shows the count and the Save button
  (#2995).
- **Floating menus are opaque in dark mode**: Training Admin **More** and the
  equipment-check builder's row and Tools menus used the translucent surface, so
  page content showed through (#2992).
- **Add Member no longer fails with a server error when a membership number is
  entered** (#2989). A function-local import made the name local to the whole
  function, so the availability check raised `UnboundLocalError`. A sweep test now
  covers the whole backend for a name used before a local import of it.

### Security and operations

- **Onboarding (#2996, ONB4-30-1, HIGH).** Two concurrent, unauthenticated calls to
  create the organization both passed the "no organization yet" check. The
  `onboarding_status` singleton row is now locked and the check is a locking read;
  verified 8/8 races → exactly one success. **ONB4-30-2 (LOW):** a failure logging
  `reset_completed` after a reset had committed no longer records a false
  "reset_failed" or returns a 500.
- **Pipeline Overview report (#2994, RPT6-29).** The report did not exclude the
  caller's own prospective-membership record, so an officer who had once applied
  saw their own name, email and stage and had it folded into the aggregates. It now
  applies the same hidden-prospect rule as every sibling route.

## Behaviour changes at a glance

| Change                                                         | Visible effect                                                      |
| -------------------------------------------------------------- | ------------------------------------------------------------------- |
| `finance.request` on the Member position                       | Every member can raise and track their own requests                 |
| Target Solutions auto-credit                                   | Matched completions become records without an officer step          |
| HIPAA / Bloodborne / Hazmat templates are Courses requirements | Officer must link the course before saving; old ones show a warning |
| Void requires a reason and tells the member                    | Bell notice and required email                                      |
| Unique staged import per provider record                       | Duplicates marked `duplicate`; none deleted                         |
| Apparatus row Archive removed; wrench opens Maintenance        | Archive from the apparatus page                                     |
| Fuel type label                                                | CNG                                                                 |

## Review passes in the window

Records live in `docs/security-review/`.

| Pass                                             | Result                                                                                                                          |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| MSUP-23 medical supplies, pass 13 (#2981)        | 0 fixed, 0 new                                                                                                                  |
| MM-24 meetings & minutes, pass 6 (#2983)         | 0 fixed, 0 new; 2 flagged items re-confirmed **open**                                                                           |
| MSG-25 messaging & notifications, pass 6 (#2984) | 0 fixed, 0 new                                                                                                                  |
| FORM-26 forms, pass 6 (#2986)                    | 0 fixed, 0 new                                                                                                                  |
| INT-27 integrations, pass 6 (#2988)              | 0 fixed, 0 new                                                                                                                  |
| SEC2-28 security audit & IP, pass 6 (#2990)      | 0 fixed, 0 new; two prior findings resolved; SEC2-28-6 and -10 remain open; one dangling `KNOWN_LIMITATIONS.md` reference fixed |
| RPT6-29 reports & analytics, pass 8 (#2994)      | **1 fixed** (pipeline overview self-exposure)                                                                                   |
| ONB4-30 onboarding, pass 6 (#2996)               | **1 HIGH fixed** (single-org race), **1 LOW fixed** (false reset_failed)                                                        |

## CI and test infrastructure (no user-visible change)

- The member ID card test now waits for the barcode draw (a passive effect that
  could land after the assertion on a loaded runner) (#2995).
- `HTTP_413_CONTENT_TOO_LARGE` replaces the deprecated status name in the upload
  endpoint.
- New regression tests: finance member requests and the grant migration, void and
  edit notices, course mapping, report upload, credit hours, Target Solutions
  keying and log redaction, onboarding race and reset logging, pipeline-overview
  privacy, requirement config warning, Add Member membership number.

## Migration route

| Revision       | What it does                                                                                                      | Downgrade                                                                            |
| -------------- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `9bb4af123ebc` | Unique `(provider_id, external_record_id)` on staged imports; settles existing duplicates first                   | Restores renamed rows' original ids and statuses exactly                             |
| `6cf89b44dc08` | Adds `policy_acknowledgment` to the training-type ENUM on five tables, keeping nullability and defaults           | Turns such rows back into `continuing_education`, narrows the ENUM                   |
| `95dbdfb6591d` | `external_course_mappings` (seeded with unmapped rows from staged course ids); `external_course_match` email type | Drops the table, **losing mappings** (records keep their course link)                |
| `26ca07c56d0f` | `training_records.voided_at / voided_by / void_reason`; two new email template types                              | Drops the columns, **losing structured void reasons** (the note in `notes` survives) |
| `7db20aa49329` | Grants `finance.request` to existing seeded Member positions                                                      | Removes it from them                                                                 |

`DATABASE_SCHEMA.md` was regenerated by the feature PRs.

## Still open (owner decisions, recorded in `KNOWN_LIMITATIONS.md`)

Everything listed in the previous audit still applies, plus: automatic crediting
for Vector Solutions, Lexipol, iAmResponding and Custom API awaits a per-provider
review; the two flagged meeting-minutes items (MM-24); SEC2-28-6 and SEC2-28-10.
The "a requirement cannot name one policy acknowledgment" limitation is resolved
by course mapping.

## Documentation and media disposition

**Updated in this pass:** this audit; the wiki handoff and sidebar/Home links;
`docs/training/06-apparatus-facilities.md` (first-run guidance, Maintenance
dates); `docs/training/02-training.md` (Member Visibility Settings layout);
`docs/training/21-october-2026-release-changes.md` (October 7 – 8 index);
`docs/UPGRADING.md` (Target Solutions auto-credit and duplicate settlement);
`wiki/Module-Apparatus.md`. The feature PRs already updated the finance,
integrations and training guides, `FINANCE_MODULE.md`, `TRAINING_PROGRAMS.md`
and `Module-Training.md`.

**Screenshots to create or replace** are in
`training/SCREENSHOT_CURRENCY.md` (section _Queued by the October 7 – 8
documentation pass_). **Script beats to fix or re-record** are in
`youtube-scripts/SCRIPT_CURRENCY.md` (section _Oct 7 – 8_). Nothing was
re-captured or re-recorded: the capture stack does not run in this environment.

**Not edited, deliberately.** `CHANGELOG.md` has been closed to per-change
entries since 2026-09-08 (see `CLAUDE.md`), so nothing was appended to it or to
`docs/changelog/`; this audit, the pull-request descriptions and `UPGRADING.md`
carry the narrative. The finance request routes were registered in all three
registries by #2991; no other route was added or retired.
