# Change audit: October 4 – 5, 2026

Net changes merged to `main` in the 25 hours ending 2026-10-05, written against
`01b1bc26` (PR #2940). It picks up where the
[September 24 – October 4 audit](./CHANGE_AUDIT_2026-09-24_TO_10-04.md) and the
[October 3 – 4 audit](./CHANGE_AUDIT_2026-10-03_TO_10-04.md) stopped, at the
documentation commits of 2026-10-04 evening (`d2348fa8`). **About 50 non-merge
commits, roughly 25 pull requests** (#2904 – #2940), most of them following that
documentation pass. **Three migrations** land in the window (the head is now
`34d3d56d1479`), one new permission (`training.view_analytics`), and one
operator-run repair script. No route was added or retired.

Wiki handoff:
[`Recent-Changes-2026-10-04-to-10-05`](../wiki/Recent-Changes-2026-10-04-to-10-05.md).

Roughly a third of the commits are review passes whose records live in
`docs/security-review/`, `docs/app-review/` and `docs/workflow-review/`:
security reviews of auth-session, cross-cutting, frontend-shared,
permissions-roles, public-webhooks and storefront-payments (all **0 fixes**,
standing findings re-confirmed); app review **A6 member lifecycle** (2 fixes,
1 flagged) and **A9 platform ops** pass 3 (4 fixes, 2 flagged); workflow review
**W52 Action items** (5 fixed, 2 flagged), **W53 Documents** (4 fixed, 1 flagged)
and **W54 org chart and legal documents** (2 fixed, 3 flagged).

## Read this first

1. **Members can go by a preferred name** (#2920, `f92fbd92`). New nullable `users.preferred_name`, migration `34d3d56d1479`
   (idempotent; NULL means "goes by first name", so nothing is backfilled).
   `User.display_name` is the preferred name else first + last and is what
   everyday screens read; `User.full_name` stays the **legal** name and no longer
   spells a missing part as "None". Reports, exports, training records,
   certificates, ballots, legal documents, signed forms, property custody and the
   audit log keep the legal name. Meeting-minute attendees, the photo-use consent
   roster, medical screening records and the member ID card were moved to the
   preferred name afterwards, and the label API's member badge follows the
   ID-card rule. Anonymizing a member now clears `preferred_name`
   (LIFE-6) — before that fix an anonymized member still appeared as
   "Terry Member-1a2b3c4d" on every everyday surface. The external-training
   **Map User** lookup, which selected the `full_name` property as a column and
   raised for any linked member, was fixed in the same window.
2. **Shift reports: five behaviour changes**, one migration and one permission (#2904).
   - **`training.view_analytics`** (migration `84819ea78a79`). The _Written by me_
     panel was titled "Your reporting summary" but summed every officer's
     reports and was served to anyone holding `training.manage`. The
     `officer-analytics` endpoint now takes `?scope=mine|department`; **`mine`
     is the default** (it used to be department-wide) and `department` needs the
     new permission, seeded to the Chief, Deputy Chief and Assistant Chief ranks
     and the President and Training Officer positions. Captains and lieutenants
     do not get it.
   - A member **cannot write a report about themselves**; the form lists only
     shifts the viewer led as Shift Officer.
   - **File Shift Report is the Shift Officer's alone** on the shift panel, and
     the assigned Shift Officer may file and complete their own shift's reports
     without `training.manage`. Leadership files from _Shift Reports → New
     report_.
   - New department setting `settings.shift_reports.authorship = 'shift_officer'`
     (**Reports are filed by the officer on the rig**, under _Shift Reports →
     Filing & Validation_, renamed from _Post-Shift Validation_). Absent or any
     other value keeps the old rule, so existing departments are unchanged.
   - Per-member **Calls Responded**, derived from the close-out.
3. **One call-type list per department** (#2904, migration `edf608b5a8ea`). A department
   had three unrelated vocabularies — the editable list in Scheduling settings, a
   free-text list in Shift Reports settings, and whatever text a training
   requirement held — and requirements matched by exact lowercase string, so a
   requirement naming `mva` credited nothing from a report listing _Motor
   Vehicle Accident_. The free-text entries are folded into the department list;
   requirements and pipelines get a **Call types that count** picker; the call
   log's incident type is a picker over the same list. Matching goes through
   `app/utils/call_type_matching.py` (slug, label or legacy text).
4. **Category credit was silently not written for multi-category
   requirements** (`5169e76b`, `9432ab8e`, `d1713f04`).
   `category_ids.contains([id])` fell back to a `LIKE` on the serialized JSON, and
   MySQL renders a stored array as `["a", "b"]`, so only a sole-element array
   matched. A requirement tagged with two or more categories never advanced from a
   finalized session or an imported external record. The query is fixed
   (`app/utils/json_ids.json_array_contains`); **already-missed credit is repaired
   by an operator-run script**, `backend/scripts/backfill_category_requirement_credit.py`
   (dry run by default, idempotent, rollback file, no notifications). The same fix
   closed `GET /training/requirements?position=%` returning every requirement
   because the caller's term was a `LIKE` pattern. Entry in `UPGRADING.md`.
5. **Editing a role that holds a wildcard works** (#2935, `8bdeaebe`). Saving any
   permission change to a role carrying `*` (IT Manager) or a `<module>.*` grant
   the setup wizard's **Manage** checkbox writes failed with 400 "Failed to update
   role" — the validator knew only the bare permission catalog, and the long
   rejection list was swapped for the generic message so the screen never said
   which grant was refused. `invalid_permission_grants()` now accepts what
   `permission_matches` resolves, on create, system-role update and custom-role
   update alike, and the rejection names at most five grants. Accepting a wildcard
   is not granting one: the grant and edit ceilings still apply.
6. **Printing a member's badge needs `members.manage` or
   `members.manage_id_cards`** in the label API too (#2860 gated only the
   screens). `POST /labels/preview`, `/generate`, `/print` for the membership
   module and `/members/print-labels` still accepted `members.view`, which every
   seeded position holds. A script calling the label API for membership as a
   plain member now gets 403. Entry in `UPGRADING.md`.

## Behaviour and layout changes

| Change                                                                                                                                                                                                                                                                                                                                                       | Reference                                        |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------ |
| **Admin hubs stopped doubling the page gutter.** `AdminHubFrame`, six hub bodies and the hub-only tabs each added `px-4 sm:px-6 lg:px-8` inside `AppLayout`'s own gutter, so hub headers sat 32px (phone) / 64px (desktop) from the edge against 16 / 32 elsewhere. Max widths unchanged.                                                                    | #2939, `5e911e39`                                |
| **Four Inventory admin pages and 16 hub tabs no longer take the screen down on a malformed response** — Pool Items, Member Equipment, Charges and the member picker read a list off an unchecked body. Guards moved into `inventoryService` (`expectArray`); Member Equipment no longer prints "No members with inventory assignments" under its load error. | #2934, #2914, `4cf2fb68`, `e6141317`             |
| **Light-theme alert text raised to AAA.** Info blue-700 → blue-900 (9.52:1), success green-700 → green-900 (8.70:1; was 4.79:1, the worst of the five), purple and danger likewise; warning unchanged.                                                                                                                                                       | `f9211ea3`                                       |
| **Primary actions that were blue are the primary red** — 42 buttons in 27 files, the Suggestion Board vote/filter pills and the IP Security tabs. Blue kept deliberately for ConfirmDialog's info variant, Start Skill Test's practice mode and two analytics chart series.                                                                                  | `786515e0`, `fd59486f`                           |
| **Touch targets are sized by pointer, not width** (`touch:` variant, `touch-target-phone`); card-grid pages fit mouse desktops (`max-w-7xl` cap, 22rem floors on Events, Past Events and Course Library); Apparatus actions moved onto the badge row; Integrations badges wrap below the title.                                                              | #2913, #2923, `89f8854e`, `6db345ab`, `bd2bbbb1` |
| **Second Playwright visual sweep.** The date/time picker no longer cuts the date to "mm/c" on a phone; stat-tile labels wrap instead of truncating ("Total B…"); Skills Testing toolbar and filter; Review Submissions and Shift Report layouts.                                                                                                             | `03403d36`                                       |
| **Training Administration tabs fit a phone** — compliance matrix, expiring certs, past events, review submissions, waivers, officer dashboard.                                                                                                                                                                                                               | #2916, `533ed718`                                |
| **Close-out wizard: type hours** for a member who forgot to check in or out. Typed hours become an end time from the check-in (or the shift's scheduled start), computed through UTC so a DST night credits what was typed; entries outside 0–48 hours hold **Next**.                                                                                        | #2904, `915075b1`                                |
| **Event detail**: the left accent is reserved for the urgency meaning it already has; the icons are lucide, not inline SVG.                                                                                                                                                                                                                                  | #2912, #2905                                     |
| **Expiring-supplies email fits a phone** — three columns (Item, Expires, Ready stock / Qty), apparatus and compartment or lot as a second line, days left under the date. The "&mdash;" fallback was HTML-escaped and printed literally.                                                                                                                     | `24fb9788`                                       |
| **Public Portal → Configuration**: the default rate limit is a controlled text field; Save refuses anything that is not a whole number from 1 to 100,000 with an inline message instead of sending NaN to a 422.                                                                                                                                             | `9a0aa84c`                                       |
| **Email Templates banner** no longer tells admins to press Reset on a template that is already current.                                                                                                                                                                                                                                                      | `54e163ff`                                       |
| **Elections** frontend follow-ups from the W50 workflow review: ballot, results, nominations, extend-election and merge-write-ins dialogs; new receipt verification and close stamp.                                                                                                                                                                         | `06c3d560`                                       |

## CI and test infrastructure (no user-visible change)

- The Playwright E2E job is split **by weight, not by test count**, and the sweep
  budgets are set from measured runs and derived into the cap (`ci.yml`; see
  `docs/` CI notes quoting the slower of two, then three, measured runs).
- A SQLAlchemy `SADeprecationWarning`, `SAWarning` or
  `SAPendingDeprecationWarning` now **fails the run**. That is how the
  `.contains` and `like_op` JSON findings above were found.
- Backend reference docs and `CLAUDE.md` say SQLAlchemy 2.1, matching the pin.

## Migration route

| Revision       | Parent         | What it does                                                                                      | Downgrade                                                      |
| -------------- | -------------- | ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `84819ea78a79` | `d058b5e7c1f4` | Grants `training.view_analytics` to seeded leadership positions that still hold `training.manage` | Removes the grant                                              |
| `edf608b5a8ea` | `84819ea78a79` | Folds `shift_review_call_types` into the department call-type list; guarded on the table existing | Removes only entries it added (marker `folded_report_types`)   |
| `34d3d56d1479` | `edf608b5a8ea` | Adds nullable `users.preferred_name`; idempotent against `repair_schema`                          | **Drops the column**, discarding preferred names entered since |

`DATABASE_SCHEMA.md` already lists `preferred_name`; if the Backend Unit Tests
job reports drift, run `cd backend && python scripts/generate_schema_docs.py`.

## Documentation and media disposition

**Corrected in this pass**

| Document                                                               | Change                                                                                                                        |
| ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `UPGRADING.md`                                                         | Four entries (preferred name, department shift-report totals, call-type fold, category-credit repair); revision list extended |
| `training/08-admin-reports.md`                                         | Editing a role that holds a wildcard; `training.view_analytics` in the permission notes                                       |
| `training/10-mobile-pwa.md`                                            | Administration hub gutter, alert contrast, red primary actions, date/time picker, expiring-supplies email                     |
| `training/02-training.md`                                              | Multi-category requirements repair                                                                                            |
| `wiki/Recent-Changes-2026-10-04-to-10-05.md`, `Home.md`, `_Sidebar.md` | New handoff page and links                                                                                                    |
| `wiki/Role-System.md`                                                  | `training.view_analytics` and wildcard editing                                                                                |
| `training/SCREENSHOT_CURRENCY.md`                                      | Shots to create and replace                                                                                                   |
| `youtube-scripts/SCRIPT_CURRENCY.md`                                   | Beats now incomplete or stale                                                                                                 |

**Already current before this pass** (written by the commits themselves):
`training/01-membership.md` (preferred names), `training/02-training.md` and
`03-scheduling.md` (shift-report authorship, Calls Responded, call types,
close-out hours), `TRAINING_PROGRAMS.md`, `SCHEDULING_MODULE.md`,
`LABEL_PRINTING_MODULE.md`, `wiki/Member-ID-Cards.md`, `KEY_ROTATION.md` and
`BACKUP.md` (NFC tags and ID cards named among what a changed `ENCRYPTION_SALT`
breaks).

**Not edited, deliberately.** `CHANGELOG.md` has been closed to per-change
entries since 2026-09-08 (see `CLAUDE.md`), so nothing was appended to it or to
`docs/changelog/`. `APPLICATION_PAGES.md`, `testingRegistry.ts` and
`mobile-route-inventory.ts` need nothing: no route was added or retired.

**Not done.** No screenshot was re-shot and no script was rewritten — the lists in
`training/SCREENSHOT_CURRENCY.md` and `youtube-scripts/SCRIPT_CURRENCY.md` are
the work order.
