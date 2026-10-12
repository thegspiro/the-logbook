# Recent changes: October 11 – 12, 2026

This wiki handoff is usable without the repository `docs/` tree. The engineering
audit is
[`docs/CHANGE_AUDIT_2026-10-11_TO_10-12.md`](https://github.com/thegspiro/the-logbook/blob/main/docs/CHANGE_AUDIT_2026-10-11_TO_10-12.md).
Predecessor: [October 8 – 11](Recent-Changes-2026-10-08-to-10-11).

**The headline:** many screens that guides described but the app lacked now exist:
**dues administration**, **grant opportunities, donations, pledges and fundraising
events**, **departure clearance**, **a meeting attendance dashboard**, **folder
management**, and a **member compliance view**.

## Read this first

**If you run the server:** six new migrations (check `alembic heads` reports one
head). Five unused settings were retired; a `.env` that still names them boots with
a warning.

**If you administer a department:**

- **Documents always live in a folder.** Anything uploaded without one goes to
  **General Documents**, and existing loose documents were moved there. Check who
  can open that folder.
- **Forms can refuse a second submission** from the same person, on the public and
  in-app paths; the builder has a control for it.
- **Election results are graded per ballot item.** Anything reading
  `overall_results` through the API should read `results_by_position`.
- **Customised email templates now show the department footer** even if they did
  not include it.

## What changed

### Finance and grants

Dues: create or edit a schedule, generate dues, record a payment. Export history
sits beside the QuickBooks mappings. Grants: **Add Opportunity** (it used to bounce
to the dashboard), **Record Donation**, **Pledges** and **Fundraising Events**.

### Inventory and equipment checks

Assignments ask **Permanent** or **Temporary** with a return date. A departure
clearance record lets you resolve each line, then complete or close it
incomplete. A short count on a shift check raises a restock report, and a lot swap
files a reorder request at the reorder point. Check reports include basic
apparatus.

### Medical screening

**Show compliance for** opens one member's or prospect's requirement-by-requirement
status; the roster has a **Not compliant (overdue)** filter.

### Meetings, events, forms and documents

Minutes: an **Attendance** dashboard, executive/trustee/annual meetings, and
action items assigned to members. Events list **guests** apart from attendance.
Forms warn before publishing a public form that would file nothing. **Manage
folder** renames, restricts, moves or deletes a folder. Failed department-message
deliveries retry five times before showing as failed.

### Elections

Proxy ballots on anonymous elections (with acknowledgement), no default Abstain,
ballot links retired when the ballot changes, auto-open sends ballots and alerts
managers if it cannot, and results grade each contest separately.

### Prospective members and settings

Referral details in the drawer, a **Department Email** section in Organization
settings, and a warning email seven days before Auto-Purge deletes an application.

### Scheduling

The close-out confirm step offers **Give everyone all _N_ calls**. Three
saved-but-inert settings are labelled "not in effect".

## Screenshots and scripts

Screenshots to create or replace and video beats to redo are queued in the
repository's `docs/training/SCREENSHOT_CURRENCY.md` and
`docs/youtube-scripts/SCRIPT_CURRENCY.md`. Nothing has been re-captured yet.
