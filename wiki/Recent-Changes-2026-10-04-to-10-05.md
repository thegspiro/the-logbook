# Recent changes: October 4 – 5, 2026

This wiki handoff is intentionally usable without the repository `docs/` tree.
The deeper engineering audit is in the source repository at
[`docs/CHANGE_AUDIT_2026-10-04_TO_10-05.md`](https://github.com/thegspiro/the-logbook/blob/main/docs/CHANGE_AUDIT_2026-10-04_TO_10-05.md).
Predecessor: [October 3 – 4](Recent-Changes-2026-10-03-to-10-04), and the wider
[September 24 – October 4](Recent-Changes-2026-09-24-to-10-04) page.

**The headline:** members can **go by a preferred name**, **shift reports** got
clearer ownership and department totals behind a new permission, and a
**training bug that silently withheld credit** from multi-category requirements
is fixed — with a one-time repair script. Nothing moved address.

## Read this first

**If you administer a department or run the server:**

- **Run three migrations** with the normal upgrade. They are safe on a populated
  database. Downgrading the last one (`34d3d56d1479`) discards preferred names.
- **Repair missed training credit once.** A requirement tagged with two or more
  categories never advanced from a finalized session or an imported record.
  New completions are now correct; credit already missed needs
  `scripts/backfill_category_requirement_credit.py` (dry run first, then
  `--apply`; it keeps a rollback file and sends no notifications). Percentages
  move once, upward. See `UPGRADING.md`.
- **Department-wide shift-report totals need `training.view_analytics`.** It is
  given to the Chief, Deputy Chief and Assistant Chief ranks and the President and
  Training Officer positions. Captains and lieutenants see only their own reports
  under **Written by me**; grant the permission if a role should see more.
- **Editing a role with a wildcard now saves.** Roles holding `*` (IT Manager) or
  a `module.*` grant failed with "Failed to update role" on any change.
- **Printing a member badge through the label API** needs `members.manage` or
  `members.manage_id_cards`. The Print Badges button already did.

**If you train or schedule people:**

- **Preferred name.** Members set it under **My Account → Account**; officers on
  **Admin Edit** or **Add Member**. The shift board, directory, messages,
  notifications, the ID card, meeting-minute attendance, the photo-consent roster
  and medical screening records show it; reports, exports, training records,
  certificates, ballots, legal documents and the audit log keep the legal name.
- **Shift reports.** A member cannot write a report about themselves. **File Shift
  Report** on a finished shift is the **Shift Officer's**; leadership uses
  **Shift Reports → New report**. An optional setting, **Reports are filed by the
  officer on the rig**, restricts filing to that officer department-wide. The
  report list gains per-member **Calls Responded**.
- **One call-type list.** Training requirements and pipelines pick **Call types
  that count** from the department list in Scheduling settings, and the call log's
  incident type uses the same list, so "mva" and "Motor Vehicle Accident" no
  longer credit differently.
- **Close-out wizard.** Type **Hours** for a member who forgot to check in or out
  (up to 48), or choose **Until shift end** / **Full shift**.

**If you use a phone or tablet:**

- Administration hub pages now sit on the same page margin as every other screen
  (they were indented twice as far).
- The date-and-time picker fits at 320px; stat tiles wrap their labels instead of
  cutting them off; Training Administration tabs fit a phone.
- Alert text in the light theme is darker (AAA contrast), and primary action
  buttons that were blue are the app's red.
- The weekly **expiring supplies** email now has three columns that fit a phone.
- Four Inventory pages and 16 hub tabs show a failed-load message instead of a
  blank error screen when the server returns something unexpected.

## Engineering notes

| Area                | Note                                                                                                                                                               |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `User`              | `display_name` (preferred else first + last) for everyday screens; `full_name` stays legal. Anonymizing clears `preferred_name`.                                   |
| JSON array matching | `app/utils/json_ids.json_array_contains` replaces `column.contains([id])`, which was a `LIKE` on serialized JSON. A SQLAlchemy deprecation now fails the test run. |
| Call types          | `app/utils/call_type_matching.py` resolves slug, label or legacy text to one type.                                                                                 |
| Roles               | `invalid_permission_grants()` accepts what `permission_matches` resolves; the rejection names at most five grants.                                                 |
| CI                  | Playwright E2E is split by weight; sweep budgets come from measured runs.                                                                                          |

## Reviews in this window

Security review (all 0 fixes): auth-session, cross-cutting, frontend-shared,
permissions-roles, public-webhooks, storefront-payments. App review: member
lifecycle (2 fixes, 1 flagged), platform ops pass 3 (4 fixes, 2 flagged).
Workflow review: Action items, Documents, org chart and legal documents.

## Where to read more

[Module-Training](Module-Training) · [Module-Scheduling](Module-Scheduling) ·
[Role-System](Role-System) · [Member-ID-Cards](Member-ID-Cards)
