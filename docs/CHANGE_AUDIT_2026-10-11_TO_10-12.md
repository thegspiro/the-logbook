# Change audit: October 11 – 12, 2026

Net changes merged to `main` from 2026-10-11 ~12:00 UTC (the tail of the
[October 8 – 11 pass](./CHANGE_AUDIT_2026-10-08_TO_10-11.md)) to 2026-10-12 13:00
UTC, written against `89ea4d6a`. About 90 non-merge commits, most of them
"owner decision" builds that turned documented click-paths into real screens.
The feature pull requests updated their own training guides and module docs; this
pass records what they changed, fills the gaps that remained (two training notes),
and queues screenshots and script beats.

Wiki handoff:
[`Recent-Changes-2026-10-11-to-10-12`](../wiki/Recent-Changes-2026-10-11-to-10-12.md).

**Migration route.** Six new revisions: `2cfc5a75105e` (meeting types),
`edb445ae5806` (voting tokens carry the voter), `7adc810c57f9` (candidate accepted
on behalf), `b834afdaffdf` (message-delivery retries), `e1a5bfe7a2ed` (place
stranded prospects) and `dcb8a46ac50c` (file unfiled documents into General
Documents, which also joins heads `3f3bd6f3c7e4` and `990e288940bc`). Run
`alembic heads`; it must report a single head.

## Read this first

1. **No document is org-wide and unfiled any more.** An upload with no folder goes
   to **General Documents**; the migration files existing unfiled documents there
   (reversible, recorded in `document_unfiled_backfill`). Previously such a
   document was readable by every `documents.view` holder outside every folder's
   rights. Review who can open General Documents.
2. **Forms: one submission per person is enforced on both paths** (builder
   control added). A form set to refuse repeats now refuses a member's second
   in-app submission too ("You have already submitted this form").
3. **Election results change shape.** Results are graded per ballot item;
   `overall_results` holds only candidates no contest claims. API consumers that
   read it must read `results_by_position`.
4. **Five settings were retired** (`RATE_LIMIT_PER_MINUTE`, `MAX_FILE_SIZE`,
   `STORAGE_TYPE`, `UPLOAD_DIR`, `DB_POOL_MIN`). A `.env` that names one still
   boots with a warning; they were never read.
5. **Customised email templates now carry the department footer** even when their
   body omits `{{footer_html}}`.
6. **Prospect Auto-Purge warns first**: coordinators are emailed seven days before
   an application is deleted.
7. **A duplicate Alembic revision is refused in production** instead of silently
   falling back.

## User-visible changes, by area

### Finance and grants

| Change                                                                                                                                                | Where documented                            |
| ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| Dues page: New/Edit schedule, Generate dues (confirmed), Record payment, for `finance.manage`                                                         | training 11; `FINANCE_MODULE.md`            |
| Export history beside the QuickBooks mappings                                                                                                         | training 11                                 |
| **Add Opportunity** screen (`/grants/opportunities/new`, `fundraising.manage`); previously bounced to the dashboard                                   | training 12                                 |
| **Record Donation** form; **Pledges** (`/grants/pledges`) and **Fundraising Events** (`/grants/events`) pages; Outstanding Pledges tile link restored | training 12; `GRANTS_FUNDRAISING_MODULE.md` |

### Inventory and equipment checks

| Change                                                                                                                                                                                 | Where documented |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| Assign and Distribute ask **Permanent** or **Temporary** with a return date                                                                                                            | training 05      |
| Departure clearance record screen: resolve lines, Complete, or Close incomplete                                                                                                        | training 05      |
| Low stock sums lots for lot-stocked items; dashboard excludes medical; a colleague's allowance and sizes need `inventory.manage`                                                       | training 05      |
| A short count on an equipment check raises a restock report; a lot swap files a reorder request at the reorder point                                                                   | training 05/06   |
| Check reports attribute to the shift's unit (basic apparatus appear); a check filed before the shift date reaches the fleet board; compliance report counts expected and missed checks | training 06      |

### Medical screening

Per-member and per-prospect compliance view (**Show compliance for**), and a
department roster with a **Not compliant (overdue)** filter; roster and report
races settled, and no one reads compliant by default. Training 13,
`MEDICAL_SCREENING_MODULE.md`.

### Meetings, minutes and events

Meeting **Attendance** dashboard (`/minutes/attendance`, `meetings.manage`);
executive, trustee and annual meetings recorded again; action items assigned to
an active member who can update their own status; guests listed on the event page
apart from member attendance. Training 04.

### Forms, documents and communications

Publish warning for public forms that would file nothing (new, added to training
07 in this pass); one submission per person with a builder control; **Manage
folder** on the Documents screen (rename, access, move, delete; system folders
protected); failed or throttled department-message deliveries retry five times
(5/10/20/40/80 minutes) then show as failed; the chosen email footer is appended
when a body omits it; web push is always pinned to public addresses. Training 07
and 08.

### Elections

Proxy ballots allowed on anonymous elections with an acknowledgement; voided
votes walked in the integrity chain; no default Abstain and Submit waits for every
item; named-election link votes record the voter; manager acceptance labelled and
the slate frozen at close; ballot links retired when the ballot changes, with a
resend prompt; non-managers see no recipients or live counts while open; auto-open
sends ballots and alerts managers if it cannot; results graded per item. Training
14 and wiki Module-Elections.

### Prospective members and settings

Referral source, referrer and interest reason in the drawer; Convert decided from
the final-stage flag; pipeline-less applicants placed on a board (stranded ones
backfilled); pipeline widget counted in SQL; **Department Email** section in
Organization settings; Auto-Purge seven-day warning. Training 01, 15,
`PROSPECTIVE_MEMBERS_MODULE.md`.

### Scheduling and reports

**Give everyone all _N_ calls** on the close-out confirm step (new, training 03);
three saved-but-inert settings labelled "not in effect"; start-of-shift reminder
email reads as on; an unstarted check points at **Complete Checklists**; reports
read date ranges on the department's calendar and warn about a range predating
the tracking mode. Audit-log **Apply** is disabled until the search changes.

### Security and engineering (no workflow change)

Single encrypted, confined storage service for uploads; org-scoped duplicate-check
lock for forms; security rotation passes on core infrastructure, frontend-shared,
cross-cutting baseline and auth/session recorded under `docs/security-review/`;
mypy and test-fixture clean-ups; reminder CC buttons raised to AAA contrast and a
44px target.

## Documentation changes in this pass

| File                                                             | Change                             |
| ---------------------------------------------------------------- | ---------------------------------- |
| `docs/training/03-scheduling.md`                                 | Give everyone all calls            |
| `docs/training/07-documents-forms.md`                            | Publish warning                    |
| `docs/training/21-october-2026-release-changes.md`               | Fifth-window index                 |
| `docs/training/SCREENSHOT_CURRENCY.md`                           | Queue of new and stale screenshots |
| `docs/youtube-scripts/SCRIPT_CURRENCY.md`                        | Beats to rewrite or re-record      |
| `wiki/Recent-Changes-2026-10-11-to-10-12.md`, `Home`, `_Sidebar` | Wiki handoff                       |

`CHANGELOG.md` is closed to new entries; the pull requests are the record.

## Gaps left open

- No screenshot was captured; every row in `SCREENSHOT_CURRENCY.md` is queued.
- No YouTube script was rewritten; beats are queued in `SCRIPT_CURRENCY.md`.
- Feature guides were written by their own pull requests; this pass spot-checked
  coverage by keyword, not line by line against the UI.
- `docs/UPGRADING.md` was not re-audited here; confirm it names the document
  filing, one-submission and retired-settings changes.
