# Change audit: October 5 – 6, 2026

Net changes merged to `main` in the 25 hours ending 2026-10-06 08:10 ET, written
against `09f24912` (PR #2964). It picks up where the
[October 4 – 5 audit](./CHANGE_AUDIT_2026-10-04_TO_10-05.md) stopped, at
`01b1bc26` (PR #2940). **About 90 non-merge commits in roughly 30 pull requests**
(#2941 – #2972), a third of them security- and app-review records. **Seven
migrations plus one merge revision** land in the window (the head is now
`15802f3df5c4`), one new endpoint family (`/member-badges`), one new
scheduled task, two new error codes and one operator-visible nginx change. No
route was added or retired.

Wiki handoff:
[`Recent-Changes-2026-10-05-to-10-06`](../wiki/Recent-Changes-2026-10-05-to-10-06.md).

Review passes in the window (records live in `docs/security-review/`,
`docs/app-review/`): security reviews of finance-approvals (1 fix), users-
organizations, elections-ballots, membership-pipeline (MP-32 fix),
medical-screening (0 fixes, MS-14 flagged), documents-legal, inventory,
facilities, apparatus-nfc (pass 14), equipment-check-shifts, scheduling and
events-requests (all 0 fixes, standing findings re-confirmed); app review
**A7 dashboard** pass 3 (7 fixes, 4 flagged), **A8 locations & kiosk** pass 3
(6 fixes, 3 flagged), **B1 medical screening** pass 5 (2 fixes, 1 flagged) and
**B2 apparatus** pass 5 (2 fixes, 1 flagged, 4 doc corrections).

## Read this first

1. **Member badges now carry a server-issued code** (`0549b7e0`). A badge used to
   encode the membership number or a short form of the member id, and the digital
   card's QR held the member id built in the browser — all readable by any member
   from the directory, so anyone could print a badge that scanned as a colleague,
   and the inventory scanner handed an unmatched QR's member id straight back to
   its caller. New `users.badge_code` (e.g. `MB-7KQ2W9HXRT`, unique per
   organization, migration `ad3b979746f1` backfills every member). It is served only
   by `GET /member-badges/{id}` (the member, or `members.manage` /
   `members.manage_id_cards`), never in roster or profile responses, exports or
   anonymized records. `POST /member-badges/{id}/reissue` cancels a lost badge.
   Labels, CR80 cards and the digital card all encode it, and both scanners send what
   they read to the rate-limited `POST /member-badges/resolve`, which answers only
   within the caller's organization. **Old badges keep resolving** (membership
   number, short id, old QR) until an officer turns off **Accept old badges**; absent
   means accepted, so nothing stops working on upgrade.
2. **CR80 ID-card printing** (`5273c49a`). **Members → select → Print ID Cards**
   renders a PDF whose page is exactly one card side (3.375 × 2.125 in) for any
   plastic-card printer with an OS driver (Zebra, Fargo, Evolis, Magicard, Entrust):
   landscape or portrait, front only or front-and-back, Code 128 or QR, from a saved
   department layout (`organization.settings["id_card_print"]`). Black-only so
   mono and colour ribbons print the same. `/member-id-cards/{layout,pdf}`, audited.
   Member **badge** labels moved from `members.view` (every position) to
   `members.manage` or `members.manage_id_cards`; `/member-id-cards` is recorded as an
   ungated essential-module API root (`dd9a3071`).
3. **Finance approval steps enforce their named approver** (`fbab5716`, `cfa518ca`,
   #2963). A step named an approver (`approver_type` / `approver_value`) that
   `approve_step` / `deny_step` never read: any `finance.approve` holder could act on
   any step and the pending list was org-wide. Now
   `finance_approver_matching.py` is the one authority (position, permission,
   specific user, email, or NULL = any `finance.approve` holder; inactive and
   other-org users never match). A non-match is a 403 (`ApproverMismatchError`)
   unless the caller holds `finance.configure_approvals` and sends an **override
   reason** (≤ 2000 characters), which is audited at warning. Separation of duties
   still blocks approving your own request. Token approve/deny refuse once the
   step is not an email step. New `GET /finance/approval-chains/approver-coverage`
   reports steps nobody can act on. **Screens:** Approvals reads _Requests waiting
   on you_, has a **Waiting on** column and a _Not assigned to you_ badge with an
   admin override dialog; request detail shows _Waiting on <name>_; Approval Chains
   settings flags a step nobody can act on with a warning chip and the count of
   requests stuck behind it. `UPGRADING.md` has an entry.
4. **A finalized event can be edited from the edit form** (`da31be81`, `16391621`,
   `690c9675`, `4ccd5daa`, #2953, #2959). Finalizing locks the fields credited hours
   come from, but the lock refused any save that _mentioned_ one and the form resends
   them all, so a typo in a closed event's title could not be fixed. The lock now
   refuses a **changed value**, compared by instant for times, string value for
   enums, and the default window for a NULL check-in rule; a refusal names only the
   fields that would change. The form shows a notice, disables the locked controls
   (type, category, schedule, check-in rules) with the reason announced, and keeps
   guest sign-in editable. A series save ("This and all future events") decides per
   finalized occurrence and no longer copies the edited occurrence's lifecycle markers
   (`attendance_finalized`, `reminders_sent`) onto the others. The refusal now reads
   "(2 of 3 finalized occurrences would change)". Review fixes: a title fix on an
   event spanning the clocks-fall-back hour is no longer refused; a stored category
   shows even when the department lists none; the unlisted mandatory member-type
   row has a 44px target.
5. **Compliance numbers moved, on purpose — five changes to one definition**
   (CLAUDE.md pitfall 29). **Read before upgrading: reported figures change.**
   - **A member nothing grades is _Not applicable_, not compliant** (`21bf76f2`,
     TR4-4). Such members leave the denominator of every compliance percentage; the
     matrix, member roster, profile card, annual report, email and CSV show **N/A**;
     a department where requirements exist but apply to nobody has no percentage.
   - **The dashboard's Department Compliance card grades like the matrix**
     (`39049cf8`, TR4-3): compliance profiles, the department thresholds and the
     at-risk tier. `ComplianceGrading` is now the one resolution of what grades a
     member.
   - **The annual and monthly compliance reports grade through compliance profiles**
     (`b1181a59`, CMP4-3). Departments without a profile see no change; stored
     reports keep the figures they were generated with.
   - **`required_roles` matches the member's rank** (`6aa066ac`, CMP4-5). It held
     rank slugs everywhere but was compared with position ids, so a requirement
     scoped only by role applied to nobody. It now grades the members of those
     ranks on every training screen and the annual report. The Shift Compliance
     report also begins honouring membership types.
   - **A certification no longer matches by course name** (`87efdf03`, migration
     `60aaf273de27`). "CPR Refresher" used to satisfy a "CPR" requirement. Every
     requirement that exists when the migration runs gets `name_match_until` = the
     day it ran (name credit kept for records on or before that day, so published
     standings do not jump); later requirements and fresh installs match only by
     linked course, training type or registry code.
     Also: **an attestation records the server's figure** (`bd7833a7`, CS-8) — the
     typed _Compliance %_ box is gone, replaced by the quarter picker the form lacked
     (without it every quarterly attestation was refused); and **Shift Compliance
     grades only shift-credited requirements** (`0392fc6d`, W37-2, migration
     `f16b004db34e`): SHIFTS requirements are credited by default, an HOURS
     requirement only when an officer ticks the new **Shift Credit** box, so an
     existing HOURS requirement **drops off that report until it is ticked**. The
     summary cards are now _Requirement Checks_, _Checks Met_, _Checks Not Met_ (they
     counted member-requirement pairs, not members; numbers unchanged, `de85965d`).
6. **Certificate files from self-reported training can expire** (`090d62f9`,
   migration `cdb725bb1d12`). New `self_report_configs.attachment_retention_days`
   (days after approval or rejection; NULL = keep, 90-day floor) under **Review
   Submissions → Settings → Certificate Files**. NULL is the default and nothing is
   backfilled, so **an upgrade deletes nothing until a department opts in**. A daily
   `self_report_attachment_retention` task unlinks files for decided submissions
   only, only inside that organization's own upload directory, then clears the
   references from the submission and every copied training record; rows are kept;
   each sweep is audited.
7. **Shift exchange needs both members qualified** (`37721521`, #2951). Each member
   works the other's seat afterwards, so each must pass the signup eligibility rule
   for it. Refused at submission when the target holds no seat, involves a training
   seat or fails either direction; `GET /scheduling/shifts/{id}/exchange-candidates`
   feeds an **Exchange With a Member** picker on My Shifts; re-checked at approval,
   where a lapsed pair is refused with the new **`LB-SCHED-002`** and the Requests tab
   offers **Approve anyway** (waives the position check only, noted on the request and
   audited). One-way offers and moves are unchanged. The dashboard's _Next 30 Days_
   list now says **Not eligible** up front instead of offering Sign Up (`65422ea6`).
8. **Cohorts: late joiners and all-or-nothing shifts** (`a8882f6f`, `ff78de73`,
   migration `d4d0a483cdd5`). The Roster tab gains **Add member**, and for each
   member who missed classes "N classes held before they joined — decide": **credit
   as completed** (writes a completed record, applied to the pipeline requirement
   keyed on the record so re-finalizing cannot double it) or **schedule a make-up**
   (copies the class, RSVPs that member alone; cancelling it reopens the decision).
   New table `course_cohort_missed_classes`, new `makeup_for_class_id`. Cohort
   _shift remaining_ and _cancel_ now pre-check the attendance lock, apply deferred,
   commit once and roll back on any failure, instead of leaving earlier classes
   moved when a later one refused.
9. **Offline and sign-out safety on shared station computers**
   (`b574c324`, `9a8af58c`, `9296a0d6`). Offline queue entries record their
   `ownerId` and are sent **only under the member who queued them**; entries queued
   before the upgrade are held, and a notice in the app shell offers **Send as me**
   or **Discard**, each behind a confirmation. A sign-out is retried three times and,
   if the server never confirms, a full-screen notice blocks the app until
   **Try signing out again** succeeds (persisted across reloads). A refresh that
   loses a rotation race returns **409 `LB-AUTH-012`** and revokes nothing; before,
   two tabs refreshing together treated the loser's next refresh as token theft and
   revoked every session.
10. **Proxy rate limits sized for a department** (`43582b39`, #2950). Both bundled
    proxies allowed 10 concurrent and 10 requests/second per address; under HTTP/2 a
    single dashboard load lost 15 of 25 requests to 503, and eight members behind one
    station address lost 190 of 200. Now `limit_conn 400` and the API zone 50/s with
    `burst=600 delay=100` (queued, not refused). Sign-in limits are unchanged and
    remain an open decision in `KNOWN_LIMITATIONS.md` (the sixth member to sign in at
    one address within a minute is refused). Operators with a customized nginx config
    should compare.

## Behaviour and layout changes

| Change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Reference                          |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| **Four alert emails say what they contain.** Low stock: "at or below reorder point". Certification expiring: subject "Expires Today" / "Expires Tomorrow" instead of "Expiring in 0 Days", same wording in-app. NFPA retirement: "approaching or past" with the past-due count. The weekly supply alert is retitled **Supplies to Replace**, its subject counts expiring and to-restock separately, and the table's _Expires_ column is **Status** ("Restock reported", "Short — 2 of 4 aboard"). | `b2226d61`, `bd95f4e7`             |
| **Five more emails fit a phone** — property return and member-dropped notice (Item / Value, details as grey lines), election results (Candidate / Votes / Result), low stock, NFPA retirement.                                                                                                                                                                                                                                                                                                    | `9c783e53`                         |
| **End-of-shift summary is retried** until its email actually sent; a member who cannot be emailed is stamped once the in-app notice is written. Repeated in-app notice on retry is the accepted cost.                                                                                                                                                                                                                                                                                             | `6e59402a`                         |
| **Scheduled-task failures reach Error Monitoring**, labelled _Scheduled task_, per organization (they reached only logs and Sentry).                                                                                                                                                                                                                                                                                                                                                              | `c951388c`                         |
| **Training records are paged** — `GET /training/records` takes `skip`/`limit` (≤ 500) and reports `X-Total-Count`; the client walks the pages. **Skills-testing** `GET /tests` returns `{items, total}` with `limit`/`offset`, server-side search and dates; the CSV export **requires a date range of ≤ 366 days** (the Test Records tab defaults to the last twelve months); `GET /templates` takes `limit`/`offset`.                                                                           | `e2ee5137`, `2b00fdbe`             |
| **My Training keeps pending records** in history (they have no completion date and fell out of the 12-month range and the 100-row limit).                                                                                                                                                                                                                                                                                                                                                         | `58760756`                         |
| **Import validates enum fields per row** with "Row N: Invalid <field> 'x'. Valid values: …" and a savepoint per row, so one bad row no longer fails every row after it.                                                                                                                                                                                                                                                                                                                           | `77420cac`                         |
| **Effectiveness tab: Submit Evaluation** — member picker, then a form for the chosen Kirkpatrick level only.                                                                                                                                                                                                                                                                                                                                                                                      | `dfb5d93a`                         |
| **Skills Testing Templates tab** always shows **Needs Validation** to `training.manage` holders, zero included, beside Pass Rate.                                                                                                                                                                                                                                                                                                                                                                 | `521c710d`                         |
| **Prospective members:** checklist-stage items are ticked in the applicant drawer and sent with **Advance**; Pipeline Settings gets **Automatic Transfer to Membership**; migration `99b16109d44c` resets stage rows left _in progress_ ahead of an applicant's current stage.                                                                                                                                                                                                                    | `fac8959a`, `a61a6ad6`, `959610c0` |
| **Edit Times pre-fills the credited check-in**, not the raw tap, so saving it unchanged no longer turns an early tap into a credited override.                                                                                                                                                                                                                                                                                                                                                    | `44b7b6a7`                         |
| **Event Requests** show the server's reason on a refused schedule or postpone.                                                                                                                                                                                                                                                                                                                                                                                                                    | `93ffd7b6`                         |
| **Shift Reports Flagged view** stays while flagged reports exist even if review is switched off.                                                                                                                                                                                                                                                                                                                                                                                                  | `5d570bc0`                         |
| **Rank resolution:** a deleted seed rank (e.g. `firefighter`) is no longer accepted once the department has a rank ladder; Assigning such a code fresh needs the rung added first.                                                                                                                                                                                                                                                                                                                | `da7d3ffe` (ONBOARD-3)             |
| **Elections** (on-screen re-drive of the W50 round): the in-app vote receipt now survives the refetch, the help popover sizes to its content, the election list dates an early close to its real close, a ballot link retired by a zero-vote rollback says the election was closed and reopened, focus after a nomination stays in the panel.                                                                                                                                                     | `92468ec2`, `5b4c798b`             |
| **Members admin and Inventory admin on phones** — no doubled padding on eight inventory pages, Items filters behind a **Filters** toggle under 640px, wrapped hub tile labels, audit-history spinner fixed, waivers tab strip scrolls, AAA link colours; Members admin routes join the mobile ratchet.                                                                                                                                                                                            | `61e21fe7`, `0cb937b0`             |
| **Medical supplies:** five writes re-check the medical domain under the lock; completing maintenance as _Retired_ is refused (use Retire).                                                                                                                                                                                                                                                                                                                                                        | `57e81e4d` (MSUP-25)               |
| **Integrations:** every sender is DNS-pinned to its validated address (SSRF rebinding); Google Calendar responses are capped at 10 MB with socket timeouts.                                                                                                                                                                                                                                                                                                                                       | `fb96e82c`, `21b2f7b8`             |
| **Performance (no visible change):** compliance grading loads only each requirement's window; document folder access uses one recursive query; facility reference and folder locking reads use new indexes (migration `c56303befb2c` adds `document_id` columns and backfills).                                                                                                                                                                                                                   | `9109d6d1`, `870ea19b`, `17bdf779` |

## CI and test infrastructure (no user-visible change)

- The scan-success timer no longer outlives an unmounted field (an intermittent
  vitest "window is not defined" failure), `cb6b6c94`.
- A raw `INSERT` in the exchange test fixture quoted the reserved word `rank` for
  MySQL 8, `26e55755`; two compound assertions were split for flake8 PT018, `b52621fc`.
- Dependabot: stripe 15.6.1 → 16.0.0, the python-minor-patch and npm-minor-patch
  groups, anchore/sbom-action 0.24.3 (#2943 – #2946).

## Migration route

| Revision       | Parent                         | What it does                                                                                                                   | Downgrade                                                                          |
| -------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| `99b16109d44c` | `b3e8d5a1c947`                 | Resets prospect stage rows left `in_progress` ahead of the current stage                                                       | No-op (the old value was the defect)                                               |
| `d4d0a483cdd5` | `99b16109d44c`                 | `course_cohort_missed_classes`, `course_cohort_classes.makeup_for_class_id`; guarded                                           | Drops both                                                                         |
| `f16b004db34e` | `d4d0a483cdd5`                 | `training_requirements.shift_credited`, backfilled true for SHIFTS requirements                                                | Drops the column                                                                   |
| `ad3b979746f1` | `34d3d56d1479`                 | `users.badge_code`, unique per organization, backfilled for every member                                                       | Drops the column, **discarding issued badge codes** — printed badges stop scanning |
| `60aaf273de27` | `f16b004db34e`                 | `training_requirements.name_match_until`, set to the migration date on existing rows                                           | Drops the column                                                                   |
| `c56303befb2c` | `60aaf273de27`                 | `facility_documents.document_id`, `facility_photos.document_id`, indexes, backfill; indexes on `document_folders` slug lookups | Drops indexes and columns                                                          |
| `cdb725bb1d12` | `c56303befb2c`                 | `self_report_configs.attachment_retention_days` (NULL = keep)                                                                  | Drops the column                                                                   |
| `15802f3df5c4` | `ad3b979746f1`, `cdb725bb1d12` | Merge — **the head**                                                                                                           | n/a                                                                                |

The two branches (preferred-name → badge code; stale-stage → … → retention) are joined by the merge. Run `alembic heads`: it must report the single head `15802f3df5c4`.
`DATABASE_SCHEMA.md` was regenerated in `cbaa7143`; if the Backend Unit Tests job
reports drift, run `cd backend && python scripts/generate_schema_docs.py`.

## Documentation and media disposition

See the files below for what this pass changed. **Screenshots to create or
replace** are listed in `training/SCREENSHOT_CURRENCY.md` (section for
2026-10-06) and **script beats to fix or re-record** in
`youtube-scripts/SCRIPT_CURRENCY.md`. Nothing was re-captured or re-recorded.

**Not edited, deliberately.** `CHANGELOG.md` has been closed to per-change
entries since 2026-09-08 (see `CLAUDE.md`), so nothing was appended to it or to
`docs/changelog/`; this audit, the PR descriptions and `UPGRADING.md` carry the
narrative. `APPLICATION_PAGES.md`, `testingRegistry.ts` and
`mobile-route-inventory.ts` needed no new route (the Members admin routes joined
the mobile ratchet in `61e21fe7`).
