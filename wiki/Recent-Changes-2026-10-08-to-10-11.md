# Recent changes: October 8 – 11, 2026

This wiki handoff is usable without the repository `docs/` tree. The engineering
audit is
[`docs/CHANGE_AUDIT_2026-10-08_TO_10-11.md`](https://github.com/thegspiro/the-logbook/blob/main/docs/CHANGE_AUDIT_2026-10-08_TO_10-11.md).
Predecessor: [October 7 – 8](Recent-Changes-2026-10-07-to-10-08).

**The headline:** members can **time pre-shift work** from the vehicle scan,
departments can **import past shifts**, **suggestion boxes ask questions and route
submissions**, and **administration hubs** became described cards with a phone-
friendly row and four new review queues. Underneath: **every stored file is
encrypted**, and **budgets need a second officer to confirm amendments**.

## Read this first

**If you run the server:** twenty new migrations (check `alembic heads` reports
one head). Stored files are encrypted from now on; run `scripts/encrypt_uploads.py`
to encrypt older ones, and confirm the encryption key is stored apart from the
server. Prospective-member Auto-Purge now deletes, counting from the upgrade.

**If you administer a department:**

- **Pre-shift work is on by default.** Members who scan a vehicle before check-in
  opens are offered **Doing pre-shift work?**. An officer must approve the time; it
  adds hours, never shifts. Turn it off in Shift Settings → **Allow pre-shift
  work**.
- Review who can approve budget amendments (`finance.budget_review`,
  `finance.manage`); the person who entered one cannot confirm it.

## What changed

### Scheduling

- **Pre-shift work.** Scan the vehicle while check-in is closed, pick the shift
  (within 48 hours), scan again to finish. Approved in the close-out wizard, the
  shift panel or the **Pre-shift time awaiting review** queue. Counts in hours
  reports, My Hours and Shift Compliance hours.
- **Shift History Import** (`scheduling.manage`): upload a CSV as a draft, settle
  members, units, positions and proposed shifts, then commit (final). Back-to-back
  entries join, with **Split apart** to undo; decisions are remembered for later
  files.
- Shifts can be put on rigs added through the Apparatus module.

### Administration hubs

Described section cards (Events, Members, Store; Training in seven areas), a
scrolling chip row on phones, hub sections in the search palette, **Headline
Metrics** on Inventory and Scheduling, and new **Needs attention** queues for
skills tests, shift reports, attendance requests and open order windows.

### Communications

Suggestion boxes can ask branching **Questions**; a dropdown or single-choice
answer can send the submission to another box, read only by that box's reviewers.
The Compliance box asks "What kind of concern is this?".

### Events, finance, apparatus

Attendance requests can be withdrawn (twice) and organizers have a cross-event
list. Finance adds next-year requests, board review, adoption, year-end close,
**My Budgets** and receipts. Apparatus explains **Deficiency**, requires a
**Reason** for Out of Service, and files photos and documents as documents. The
equipment-check builder fits a phone.

### Security

Per-file AES-256-GCM encryption at rest, an encryption-key confirmation in setup,
organization-first upload storage, and the end of the client-supplied-ID sweep
(XC-1) across training, scheduling, events, inventory, apparatus and others.

## Screenshots and scripts

Not re-captured. The queue is in `docs/training/SCREENSHOT_CURRENCY.md` and
`docs/youtube-scripts/SCRIPT_CURRENCY.md`.
