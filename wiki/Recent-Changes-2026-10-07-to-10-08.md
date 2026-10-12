# Recent changes: October 7 – 8, 2026

This wiki handoff is intentionally usable without the repository `docs/` tree.
The deeper engineering audit is in the source repository at
[`docs/CHANGE_AUDIT_2026-10-07_TO_10-08.md`](https://github.com/thegspiro/the-logbook/blob/main/docs/CHANGE_AUDIT_2026-10-07_TO_10-08.md).
Predecessor: [October 6 – 7](Recent-Changes-2026-10-06-to-10-07).

**The headline:** **every member can raise their own finance requests**,
**Target Solutions imports credit members automatically** (with a manual report
upload and course mappings), **officers can void or edit a training record and the
member is told**, and the **apparatus pages guide a first-time chief**.

## Read this first

**If you run the server:**

- **Five migrations** land after head `8c4f2a6e1d93` (new head `7db20aa49329`). One
  makes staged training imports unique per provider record; existing duplicates are
  marked, never deleted. Downgrading drops course mappings and the structured void
  reasons.
- **Every member gains the `finance.request` permission** through the seeded
  **Member** position. Remove it from that position if you do not want members
  raising requests. See the 2026-10-07 entry in `docs/UPGRADING.md`.

**If you administer a department:**

- **Target Solutions** completions that match a member become training records at
  sync or upload; unmatched ones wait under **Imports**. Other providers still need
  an officer's review.
- **Fix your HIPAA, Bloodborne Pathogens and Hazmat requirements.** The templates
  now create **Courses** requirements; the old "hours of this type" form let any
  CAPCE hour satisfy a HIPAA refresher. Existing requirements are not rewritten and
  show a warning on their card.

## What's new

### Finance

- Members see **My Purchase Requests**, **My Expense Reports** and **My Check
  Requests** under a new **Finance** entry in the navigation. They create, edit
  and submit their own, and withdraw a draft purchase request. Another member's
  request is not found. Approval chains still apply; nobody approves or pays their
  own.
- Forms offer budget lines by name and amount remaining ("Training — $1,250.00
  remaining") without budget access. Ordering, receiving, paying, issuing and
  voiding stay with finance managers.

### Training provider imports

- **Upload Report** on a Target Solutions card takes the completions-report CSV
  with no key. Sync and upload never record a completion twice.
- The live report format is now accepted; members are matched by Employee ID when
  email finds nobody; hours come from **Duration (hours)**; "Admin" items become the
  new **Policy Acknowledgment** type.
- **Mappings › Courses** maps a provider's new Course ID to your library course so
  a requirement stays met when the provider issues a new version. Training officers
  get a **New Course Version to Map** email.
- Import and Bulk Import buttons now keep the category and hours you choose.

### Training records

- **Void** (with a required reason) and **Edit** on a member's Training History.
  The member sees the reason, and gets a bell notice and a required email. A void is
  final and removes a qualification the record granted.

### Apparatus

- An empty fleet says **No apparatus yet** and explains what to add; the Add form
  says what is required; NFPA tracking is per vehicle; fuel reads **CNG**.
- The row wrench opens **Maintenance**; Archive is on the apparatus page. The
  maintenance form explains which date to use; the Equipment tab explains it is not
  the crew's shift checklist and links to the builder.
- Status and type badges are readable (contrast fixed).

### Smaller changes

- Member Visibility Settings: grouped cards, two columns, and a pinned Save bar
  with the unsaved count.
- Floating menus (Training Admin **More**, equipment-check builder) are opaque in
  dark mode.
- **Add Member** with a membership number no longer fails.

## Security review

Eight passes. Two changed code: **onboarding** (a race let two simultaneous
first-run requests create two organizations; fixed, plus a false "reset failed"
log entry) and **reports** (the Pipeline Overview showed an officer their own
prospective-member record; fixed). The rest found nothing new.

## Where to read more

[Module-Training](Module-Training) · [Module-Apparatus](Module-Apparatus) ·
the repository's `docs/training/11-finance.md`, `16-integrations.md`,
`06-apparatus-facilities.md` and `docs/UPGRADING.md`.
