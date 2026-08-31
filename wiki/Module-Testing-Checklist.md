# Testing Checklist

**Became a module 2026-08-27, and it ships switched off.** The page that lists
every screen in the application so a department can walk them before going
live.

- **Pages:** `/testing` (Testing Home), `/testing/report/print` (printable report)
- **Access:** any signed-in member, **while the module is on**
- **Module flag:** `testing` — **defaults to false**
- **Tables:** `testing_checklist_entries`, `testing_runs`
- **API:** `/api/v1/testing-checklist`

## Where did `/testing` go?

If you were using the Testing Home before upgrading, it is gone until an
administrator turns it on at **Settings → Modules → Testing Checklist**.

**Marks held on the server are not lost.** They stay in the database and
reappear the moment the module is switched back on. While it is off, the
navigation entry, the route and the data behind it all refuse — the same way
every other switched-off module behaves.

> **⚠️ One exception, and it bites exactly the department this page is for.**
> The checklist used to keep marks in the **browser**, under
> `logbook.testing-checklist.v1`. When it moved to the server there was no
> import path, and there still isn't. If you are part-way through a
> walkthrough on a build from before that move, **export your run before you
> upgrade** — re-enabling the module afterwards gives you an empty server run,
> not your previous marks.

**It is not offered during first-time setup.** It is a tool for checking an
installation, not a decision a department needs to make while making every
other one.

## Runs

Work is organised into **runs** — one named pass over the application, e.g.
"Pre-launch, build 1.4".

- Starting a new run **archives** the one before it. Its marks stay readable
  and exportable from the run picker rather than being cleared away.
- The first mark opens a run on its own, so you do not have to remember to
  start one.
- Marks record the **build** they were made against. After a deployment, the
  marks made on an earlier build are flagged and can be filtered with **Needs
  re-test**.

## Marks are checked against what the app expected

Every page in the checklist carries an expected access verdict for the account
doing the testing. When a mark is made, the observed result is compared to it:

- A refusal that happened **as predicted** is counted as a **gate verified** —
  positive evidence, not a gap in coverage.
- A page that **opened for an account that should have been refused** is
  flagged where the mark was made, counted in the header, and listed in the
  printed report as a **permissions defect**.

That distinction is the reason the module exists as more than a list of
tickboxes: it separates "this screen is broken" from "this screen is visible to
the wrong people".

## Exports

- **Mark CSV** — every mark, for a spreadsheet.
- **Permission matrix** — page by tester, for handing to whoever signs off.
- **Printable report** (`/testing/report/print`) — coverage, failures with
  notes, gate mismatches, and coverage by area. Save as PDF.
- **Markdown** — the original export, unchanged.

## Keyboard marking

`j` / `k` move between boxes, `p` / `f` / `b` mark the focused one, and `n`
jumps to the next page with no mark.
