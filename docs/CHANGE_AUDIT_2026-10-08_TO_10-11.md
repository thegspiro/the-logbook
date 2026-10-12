# Change audit: October 8 – 11, 2026

Net changes merged to `main` from 2026-10-08 13:13 UTC (the end of the
[October 7 – 8 pass](./CHANGE_AUDIT_2026-10-07_TO_10-08.md)) to 2026-10-11 11:40
UTC, written against `56e88f49` (PR #3070). About 130 non-merge commits.
This pass also covers the gap between the last two passes: the October 9 work
was largely documented by the commits that shipped it, so this audit records
what they changed and names the guides that gained text here.

Wiki handoff:
[`Recent-Changes-2026-10-08-to-10-11`](../wiki/Recent-Changes-2026-10-08-to-10-11.md).

**Migration route.** Twenty new revisions in this window. Run `alembic heads`; it
must report a single head. The newest are `46c55e6a3330` (pre-shift work),
`778c3de73086` (suggestion intake questions) and `4b7e1f0c9a2d` (Compliance box
question). The last 25 hours added only those three.

## Read this first

1. **Pre-shift work is on by default** (`scheduling.pre_shift_work_enabled`).
   Members scanning a vehicle before check-in opens are offered "Doing pre-shift
   work?". Nothing counts until an officer approves it, and it adds hours, never
   shifts. Switch it off under Shift Settings → **Allow pre-shift work**.
2. **Stored files are encrypted at rest and setup asks for key custody** (from
   October 9). Existing files stay plaintext until the operator runs
   `scripts/encrypt_uploads.py`; settings holders see a notice until they confirm
   `ENCRYPTION_KEY` and `ENCRYPTION_SALT` are kept apart from the server and its
   backups. Detail in `docs/UPGRADING.md` and `docs/FILE_STORAGE_HARDENING.md`.
3. **Budgets are governed by confirmation and stages** (October 8 – 9). Amendments
   wait for a second officer; once a budget goes before the board a line's amount
   changes only by confirmed amendment; adopting, starting and closing a fiscal
   year are separate Treasurer steps. `docs/UPGRADING.md` carries each.
4. **Prospective-member Auto-Purge now deletes** (October 9), counting from the
   upgrade. See its UPGRADING entry.
5. **Document folders open to module rights** (October 9); read who now sees what.

## User-visible changes, by area

### Scheduling

| Change                                                                                                                                        | Where documented                                                             |
| --------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Pre-shift work from the vehicle scan, officer approval, hours-not-shifts                                                                      | training 03; `SCHEDULING_MODULE.md` (Pre-Shift Work); wiki Module-Scheduling |
| Shift History Import: draft, members/units/positions/shifts review, joined entries (Split apart / Rejoin), remembered decisions, final commit | training 03 (new this pass); APPLICATION_PAGES.md                            |
| A shift can be put on a rig from the Apparatus module (`/scheduling/apparatus-options`)                                                       | training 06 (new this pass)                                                  |
| Scheduling reports stat cards shrink at 320px                                                                                                 | layout only                                                                  |

### Administration hubs

Described cards for Events, Members and Store; Training's seven areas with
described destinations; a scrolling chip row with an edge cue on phones; phone
metric slots (two); Inventory and Scheduling cards with **Headline Metrics**;
hub sections in the command palette; stale back links, repeated titles and the
duplicate **Add Member** button removed; four new **Needs attention** queues
(skills tests awaiting validation, shift reports, department-wide attendance
requests, open order windows). Documented in training 08 and 10. Tab URLs
(`?page=`, `?tab=`) are unchanged.

### Communications

Suggestion boxes ask branching intake questions and can route a submission to
another box; the Compliance box is seeded with a required concern-type question
(training 07, `COMMUNICATIONS_MODULE.md`, wiki Module-Communications).

### Events

"I was there" requests can be withdrawn (two per event, then final), and
organizers get a cross-event list at `/events/attendance-requests` with a
**My events / All events** toggle for `events.manage`. Already in training 04 and
wiki Module-Events.

### Finance

Budget owner positions and stations; amendments, reversals and second-officer
confirmation; next-year requests with leadership and board review; adoption,
start, year-end close and lock; **My Budgets**; receipts on requests and expense
lines (filed as documents); QuickBooks journal-entry export held to Intuit's
rules. Already in training 11 and `FINANCE_MODULE.md`.

### Apparatus and facilities

Deficiency explanation and Failures link; required **Reason** for statuses that
need one; photos and documents filed as real documents; equipment-check template
builder restacked for phones; facility compliance checklist creation fixed.
Training 06 and 10.

### Members and training admin

Admin-hours entry methods read **QR Scan**, **ID Card Station**, **Manual**,
**Event Attendance** (training 01). Training requirement edits persist clearing
categories and widening a type. The Members guide was rewritten in plain
language on October 11.

### Security and storage

- Every stored file is encrypted (AES-256-GCM, per-file key); downloads stream
  plaintext; emailed attachments are decrypted first. Uploads are organization-
  first, scanned and confined to their organization.
- **XC-1 closed** (October 8 – 11): client-supplied foreign keys are checked in
  the caller's organization across members, elections, minutes, forms, training,
  scheduling, events, inventory and apparatus; the coverage check then found and
  fixed `required_skills` and `target_roles` on training requirements and
  programs. A program imported from another department keeps only this
  department's own positions rather than being refused. Recorded in
  `docs/security-review/` and `ORG_SCOPING_SWEEP.md`.
- The audit-history page no longer writes a "profile viewed" entry on itself;
  the export readiness route is monitored for data exfiltration.

### Engineering (no workflow change)

SQLAlchemy models typed with `Mapped`; mypy errors cleared across `app/`; frontend
tests now type-check (`typecheck:tests`); screenshot placeholders hidden from
readers (`docs/training` placeholders stay for the capture tools).

## Late additions (merged 2026-10-11 10:50 – 12:01 UTC)

- **Suggestion intake answer types:** rating, time, pick a member, pick a vehicle,
  and "at least / at most" follow-up rules (shared with Forms number fields). No
  schema change. `GET /suggestions/pick-options` returns whole lists, never a
  search, so typed names stay out of the access log. Training 07.
- **Equipment-check builder links to medical supplies** and **Clone checklist**
  asks for the target apparatus (it never worked before). Training 05.
- **Shift history import creates former members as archived**, not inactive
  (migration `990e288940bc`, touches only rows the import wrote). The roster opens
  on **All Current**; the Total Members card excludes archived members. Training 03.
- **QuickBooks export sends each payment once** and reverses a check voided after
  export (migration `3f3bd6f3c7e4`; `includeExported` re-sends a period). Already
  in training 11 and `docs/UPGRADING.md`.
- The Scheduling guide (03) was rewritten in plain language the same day; the new
  section here was re-applied on top of it. Its inline screenshot notes moved to
  `SCREENSHOT_CURRENCY.md`.
- Migration head moved past the three listed above: `3f3bd6f3c7e4` and
  `990e288940bc` are also new. Run `alembic heads`.

## Documentation changes in this pass

| File                                                                                                           | Change                                            |
| -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| `docs/training/03-scheduling.md`                                                                               | New: Pre-Shift Work and Importing Shift History   |
| `docs/training/06-apparatus-facilities.md`                                                                     | New: Deficiency, status reason, shifts on a rig   |
| `docs/training/07-documents-forms.md`                                                                          | New: suggestion-box intake questions and routing  |
| `docs/training/08-admin-reports.md`                                                                            | New: Administration hubs section                  |
| `docs/training/10-mobile-pwa.md`                                                                               | New: hubs and checklist builder on a phone        |
| `docs/training/21-october-2026-release-changes.md`                                                             | Fourth-window index                               |
| `docs/training/SCREENSHOT_CURRENCY.md`                                                                         | Queue of new and stale screenshots                |
| `docs/youtube-scripts/SCRIPT_CURRENCY.md`                                                                      | Beats to rewrite or re-record                     |
| `docs/UPGRADING.md`                                                                                            | Pre-shift work, history import, suggestion intake |
| `wiki/Recent-Changes-2026-10-08-to-10-11.md`, `Home`, `_Sidebar`, `Module-Scheduling`, `Module-Communications` | Wiki handoff                                      |

`CHANGELOG.md` is closed to new entries; the pull requests are the record.

## Gaps left open

- No screenshot was captured; every row is queued, not done.
- No YouTube script was rewritten; the beats are queued in `SCRIPT_CURRENCY.md`.
- The history import's CSV column names are not listed in the guide because the
  in-app template is the source; confirm the guide's wording against it.
- Compliance's "not watched around the clock" help text is worth a human read
  against department policy.
