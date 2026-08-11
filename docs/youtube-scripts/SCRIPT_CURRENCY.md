# Script currency

Which YouTube scripts still describe the application, and which have gone out of
date. Companion to
[`docs/training/SCREENSHOT_CURRENCY.md`](../training/SCREENSHOT_CURRENCY.md),
which does the same job for the training-guide images.

A script goes stale in three distinct ways, and they cost different amounts to
fix:

| Kind            | What it means                                                                                           | Cost                                                                 |
| --------------- | ------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| **Wrong**       | The narration describes a control, screen or behaviour that does not exist. Re-record the take          | High — it is a lie on camera                                         |
| **Incomplete**  | Everything said is still true, but a feature the audience needs has shipped since. Add a section        | Medium — usually a new chapter, and it moves the timestamps after it |
| **B-roll only** | The words hold; the screen behind them looks different. Re-capture the screen recording, keep the audio | Low                                                                  |

> **Nothing in this series has been recorded yet.** Every entry below is a
> correction to make **before** the take, not a re-record. That is the cheap
> moment to fix these, which is the reason this file exists now rather than after
> production.

---

## Resolved 2026-08-11

Everything the first pass flagged has now been **written**, not just noted.
Kept here rather than deleted, because the record of what changed and why is
what a future reader needs when a take does not match the page.

| Script | What was done                                                                                                                                                                                                               |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **06** | Dashboard chapter rewritten against the real page; new **RECORDING WHAT YOU USED** section (15:30 – 17:30); every chapter and clip timestamp re-cut; runtime estimate raised to 22–26 min in the series overview            |
| **07** | Email chapter expanded from 25 seconds to 2 minutes and renamed **…FINDING THINGS, SIGNING THEM, AND CLOSING THEM**; footers, organization variables and the design change all written; chapters 6–7 re-timed; new clip row |
| **04** | New **WHAT'S EXPIRING ON YOUR TRUCKS** beat (20:15 – 21:30); chapters 6–8 re-timed; new clip row. The dashboard flag is downgraded to a B-roll note — the narration there was always correct                                |
| **08** | All five proposed shorts written in full: **8AA** – **8AE**                                                                                                                                                                 |
| **03** | Salesforce service-account setup added to External Integrations: My Domain, client credentials, dedicated Run As user, least privilege, readiness/preview, external IDs, sync direction, retry and pagination behavior      |

**One correction to the first pass.** It said script 06's "Training Status"
widget did not exist. More precisely: there is no permanent widget with a
green/amber/red state, but there **is** a red certification banner that appears
only when something is expired or within 60 days, and a **My Training Progress**
panel that renders only for members enrolled in a pipeline. The rewrite is
written against those two, and carries a production note that both are
conditional — a demo account without them is a shorter page than the narration
walks.

### Deliberately not done

**03 — IT Manager / System Admin: the `alembic heads` beat.** Judged not worth
it. The duplicate-revision-id problem is a _contributor_ concern — it bites
someone writing a migration on a branch, not an operator running `git pull`. The
operator-facing half (recognising a crash on start) is already covered by
`WHEN THE APP REFUSES TO START`, and adding to that section ripples timings
through three chapters of a 40-minute script for about fifteen seconds of
content. `docs/TROUBLESHOOTING.md` (_Alembic Duplicate Revision IDs_) and
`docs/ALEMBIC_MIGRATIONS.md` (_Current Head_) are the right homes, and both
carry it — the troubleshooting entry now records the 2026-08-10 recurrence as
the third instance, with the habit that avoids it.

**A pre-existing timing overlap in script 04**, unrelated to this work:
`CLOSING & PUBLISHING RESULTS (17:30 – 18:00)` and
`DEPARTMENT ANNOUNCEMENTS (17:45 – 18:00)` overlap by fifteen seconds. Left
alone — it predates these changes and a timing audit across the whole series is
its own pass.

---

## Flagged by the 2026-08-10 → 08-11 changes

Two branches landed on 2026-08-10 that reach the scripts: the **email template
catalogue and footer library**, and the **inventory ↔ equipment-check supply
loop**. A third, smaller set of fixes changed what several screens render.

### 07 — Secretary & Administrative Officer Guide

**Section: `EMAIL TEMPLATES — FINDING THINGS, AND SIGNING THEM` (15:20 – 15:45)**
· **Incomplete**, and its B-roll is wrong.

- **Add the Footers tab.** The footer used to be copy-pasted into all 35 default
  bodies, so changing the wording meant opening 35 templates one at a time. It is
  now a named library — **Internal**, **Public**, **Official notice** — that a
  secretary edits once. This is squarely this audience's job and is arguably the
  single most useful thing in the chapter.
- **Add the new organization variables** — tax ID, FDID/state ID **with the name
  of the scheme**, county, founded year, fax. The `{{organization_identifier}}` /
  `{{organization_identifier_label}}` pair is the one worth demonstrating: an
  official notice that reads "FDID 12345" and is right about which identifier
  that is.
- **The B-roll shows the old email design.** Outgoing mail is now a white card on
  a grey page; the full-bleed red band over a grey slab is retired. Any
  screen-capture of a template preview must be re-shot.
- **Budget for it.** This is a 25-second beat that now has two more subjects in
  it. Either grow the chapter to ~2 minutes or split the footer library into its
  own short (see the proposed 8AA below).

**Section: `DEPARTMENT MESSAGES`** · **B-roll only.** No behaviour change, but
any email preview in shot carries the old design.

### 06 — The Member Experience

**Section: `THE MEMBER DASHBOARD` (2:30 – 4:00)** · **Wrong.**

- The narration lists a **"Training Status"** widget with green/yellow/red
  certification health. **There is no such widget.** The dashboard has an hours
  row, department messages, notifications, two shift panels, upcoming events,
  recent activity, an ID card and an equipment panel. Rewrite the widget tour
  against the real page.
- **"My Shifts"** in the narration is two panels, not one: **My Upcoming Shifts**
  and **Open Shifts**. The Open Shifts panel is capped at five with an "N more"
  line — before 2026-08-10 it rendered every open shift in the next 30 days, which
  on a real department is dozens of rows and made the dashboard several thousand
  pixels tall. Any B-roll shot before that fix shows the long version.

**New section needed: reporting supplies you used.** · **Incomplete.**

This is member-facing crew work and it belongs in this guide, not in the chief's:

> Scheduling → Equipment Checks → **Apparatus Inventory**. Pick your rig, find the
> item, tap **−**. That is it — the count comes down and the supply officer sees
> it, without you starting a whole check or waiting for the morning.

Place it after the shift chapter. Two to three minutes. Worth saying out loud
that this needs no officer permission, because the entire point of the feature is
that the person who used the last one is the person who records it.

### 04 — Fire Chief & Department Leadership Guide

**Section: `DASHBOARD OVERVIEW` (2:00 – 3:30)** · **B-roll only** — same Open
Shifts cap as above.

**Section: the end-of-shift equipment-check toggle (~479–483)** ·
**Incomplete.**

Add a beat on the **supply worklist** (Scheduling → Supply). It answers a
question chiefs actually ask — what is about to expire on my apparatus, and is
there stock behind it — and it splits the list by whether an in-date lot is
actually available, because "swap it" and "order it" are different jobs. Mention
the weekly alert.

### 03 — IT Manager / System Admin

**Section: opening sidebar tour** · **B-roll only.**

**Consider adding:** the migration head moved to `20260810_0008`, and four of
those migrations were **renumbered** because two branches claimed the same
revision id. A duplicate revision id is not a merge conflict git can see — the
backend crashes on startup. If this guide covers upgrades at all, "run
`alembic heads` after merging" is a 20-second beat that saves somebody a bad
evening.

### 08 — Quick Tips & Shorts

**Existing shorts:** no corrections needed.

**Proposed new shorts**, all of which are 30–45 second single-action pieces —
which is what this format is for:

| ID      | Title                                                | The one action                                                                                      |
| ------- | ---------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| **8AA** | Change Your Email Footer Once, Not Thirty-Five Times | Communications → Email Templates → Footers, edit, save                                              |
| **8AB** | You Used the Last One — Tell the Truck               | Apparatus Inventory → find the item → tap **−**                                                     |
| **8AC** | Log a Whole Delivery in One Screen                   | Inventory → Manage Items → Receive Stock, four lines, one date                                      |
| **8AD** | Why Your Reorder Alert Never Fired                   | On-hand comes from **in-date lots** for anything stocked that way, and expired stock counts as zero |
| **8AE** | Three Boxes, Three Expiry Dates, One Bracket         | The lots sheet on a position — and why the date shown is the **soonest** aboard                     |

**8AD is the highest-value one in this list.** A consumable stocked purely
through dated lots used to sit at zero ready units and never trip its reorder
alert, because the alert read a `Quantity` field nobody maintains for lot-tracked
stock. Departments that have been quietly running out of things will recognise
the symptom immediately.

### 02 — First-Time Setup & Onboarding · 05 / 16 — Training Officer · 09–15

**No changes.** Checked against the 24-hour diff: nothing in these scripts'
subject areas moved, apart from cosmetic email styling that appears in none of
their B-roll.

---

## Standing note on the email B-roll

Any shot of a **sent email**, a **template preview**, or the **Email Templates
page** anywhere in the series now shows a design that no longer ships. The header
band, the page background and the table styling all changed on 2026-08-10, and
templates whose CSS was never hand-edited now track the built-in stylesheet
rather than carrying a frozen copy — so this will keep happening as the default
improves.

**Shoot email B-roll last**, and re-shoot it as a batch rather than per-script.
