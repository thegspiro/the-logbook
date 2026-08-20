# Script currency

## Flagged by the 2026-08-17 → 08-19 changes

Full reason/data-path context in
[`../CHANGE_AUDIT_2026-08-17_TO_19.md`](../CHANGE_AUDIT_2026-08-17_TO_19.md#documentation-and-media-disposition).

The window produced **one Wrong**, one **Dangerous-if-recorded** (a number a
chief could put in a grant application), and a set of **additions** that are
new material rather than corrections.

### 04 — Fire Chief / Leadership · **WRONG — corrected in-script 2026-08-19**

Two separate problems in the same script, and the second is the serious one.

**1. The close-out chapter narrates a screen half the audience will not have.**
`### SETTING SHIFT CLOSE-OUT RULES (19:45 – 20:15)` walks the close-out rules
card and then describes what an officer sees at finalize. As of 2026-08-19 a
department that has switched on **Record a call count at close-out** gets a
**three-step wizard** instead of the single checklist — different screen,
different flow, and the toggle that switches between them is _on the very card
the presenter is standing on_ and is not mentioned.

The card needs the new toggle named, and the officer-facing consequence stated:
turning it on changes what your officers see at 0700 the same morning.

**Both are now rewritten in `04-fire-chief-leadership-guide.md`** rather than
left in this queue, per the standing rule that no behavioural content lives only
in SCRIPT_CURRENCY.

**2. The call-volume figure needs the caveat said out loud, on camera.**
`### SCHEDULING REPORTS (21:30 – 22:15)` sends a chief to a report that, for a
count-only department, is labelled **Unit Responses** and _is not a department
call count_. Two units that closed out independently each reported their own
call, so an MVA that an engine and a medic both ran appears twice.

This script's audience is precisely the person who puts that number in a grant
application or an ISO submission. **A narrator who says "here's your call
volume" over that screen is teaching a reporting error with a funding
consequence.** The caveat is one sentence and it must be in the take:

> **Three additions to this beat _(2026-08-19, from the Codex review of
> PR #1573)_.** They change what can safely be shown, not just what is said.
> **(a)** Switching the demo department to per-incident mode does **not** make
> "total calls" safe — that figure sums `calls_responded` across *per-trainee*
> shift completion reports, so a shift with two enrolled trainees counts twice.
> Neither mode yields a quotable incident count. **(b) Do not show a CSV
> export in this chapter.** The export still labels the column "Total Calls" in
> both modes, so it visibly contradicts the tile beside it on camera. **(c) Do
> not promise a per-apparatus breakdown** — the API returns one, the screen does
> not render it. Tracked as SCHED-13/15/16 in `docs/KNOWN_LIMITATIONS.md`.

> "If your department records call counts at close-out, read the label — this
> is _unit responses_, not incidents. An MVA two units ran shows up twice.
> Reconcile mutual responses before this goes in a grant application."

**B-roll check:** any planned shot of the finalize checklist must be captioned
as the detailed-mode screen, or shot twice — once per mode.

**EDITOR:** the close-out chapter grows by roughly **60–90 seconds** (the new
toggle, the three wizard steps, and why they save as they go). Scheduling
Reports grows by **~15 seconds** for the caveat. Both sit inside existing
chapters, so **only the bands from 19:45 onward re-time**, not the whole script.
Final timecodes are a recording-production task.

### 08 — Quick Tips & Shorts · **written in-script 2026-08-19**

- **Short 8J** (end-of-shift checks) still holds for detailed-mode
  departments, but for a count-only department the override moved to the **last
  step of the wizard** rather than the dialog it shows. A shooting note is now
  in the short itself: film it on a detailed-mode department, which keeps the
  take correct as filmed, and do not mix both screens into one 50-second clip —
  a viewer has to recognise their own screen immediately or the format fails.
- **New short 8AG, "Tap Instead of Scan"**, is written. Needs a **real Android
  phone and a real tag**; it cannot be captured in the harness, and anyone who
  has used NFC will spot a staged shot. Its production note also rules out
  shooting it on a room kiosk card — those are deliberately not taggable, and
  showing a viewer hunting for a button that is correctly absent teaches the
  wrong thing.

### 01 — Installing The Logbook · **written in-script 2026-08-19**

A new chapter, **CHECK IT BEFORE YOU START IT (10:45 – 11:00)**, now sits ahead
of START THE SERVICES in the script. It adds the preflight check before the
first `docker compose up`:

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml \
  run --rm --build backend python -m app.preflight
```

This is the single best 60 seconds available anywhere in the series. It converts
"discover the configuration problem by losing the service" into a command run
beforehand. Two details have to be in the narration or the advice is worse than
useless:

- **`--build`**, or the viewer checks the image they are replacing rather than
  the one they are deploying.
- **The same `-f` files the deployment uses**, or Compose evaluates only the
  base development configuration and answers about a setup nobody runs.

**EDITOR:** lands inside the existing pre-launch chapter. Budget **60–80
seconds**; no chapter re-ordering.

### 03 — IT Manager / System Admin · **written in-script 2026-08-19**

Two sections added to the script body, both post-setup and both in scope:

- **`python -m app.preflight --compose PATH`** — names the settings a compose
  file _drops_, i.e. values sitting in `.env` that never reach the container.
  Those used to become defaults silently, which is how a production stack ends
  up running a development setting with nothing on screen to say so. This is an
  IT manager's problem specifically, and belongs here rather than in 01.
- **The sign-in hardening posture, and which way each control fails.** Worth
  saying explicitly because the two directions are opposite and deliberate:
  breached-password lookup **fails open** (it is supplementary — complexity,
  history, MFA and lockout still apply, and an outage must not block a password
  change), CAPTCHA **fails closed** (nothing sits behind it, so accepting
  unverified traffic during an outage is the state an attacker wants). Also
  worth one line: enabling CAPTCHA widens the CSP for the provider's widget
  origins, and a misconfigured provider presents as _"the challenge never
  appears"_ rather than as an error.

Written as **Chapter 5 → "Brute-force protection, and which way each control
fails"** and **Chapter 9 → "Ask before you restart"**.

**Do not let a delivery pass compress the fail-open / fail-closed beat into
"both are security checks."** That they fail in opposite directions is the
entire content of the section — breached-password checking must not block a
password change during an outage, and CAPTCHA must not admit unverified traffic
during one. An editor smoothing those into one sentence removes the only thing
a viewer needed to hear.

**Demo environment:** the `--compose` beat needs a compose file that genuinely
drops a setting present in `.env`. Without that fixture the command prints an
empty list and the section has nothing behind it.

**EDITOR:** ~2:30 total, both inside existing chapters. Chapter 5's addition
re-times everything from 17:30 onward; Chapter 9's re-times only Chapter 9 and
the last rows of the clip table.

### 06 — Member Guide · **written in-script 2026-08-19**

`### QR CODE CHECK-IN (6:30 – 7:30)` has gained the NFC alternative in-script.
The added narration keeps it short, because for most members it is one extra
option and one limitation:

> "If your station has put up an NFC tag, you can just hold your phone against
> it instead of scanning. If the app's already open on screen, use **Tap Tag**
> on the Events page — Android won't hand the tag over while the app is in
> front."

**Say the limitation, do not bury it.** Chrome on Android, over HTTPS. iPhone
cannot do this and neither can a desktop, and a member who tries it on an
iPhone and fails will assume the app is broken rather than that their phone
does not have the hardware API.

**B-roll:** needs a real Android phone and a real tag. This cannot be captured
in the screenshot harness, and a mocked-up shot will look wrong to anyone who
has used one.

**EDITOR:** ~25 seconds inside the existing chapter; the clip table entry at
`| QR Code Check-In | 6:30–7:30 |` keeps its title or becomes "Checking In with
a QR Code or a Tap".

### 10 — Training Pipelines, Member · **verify only**

Members whose training requirements count calls will see credit arrive from
close-out rather than from per-incident logging if their department switched
modes. Nothing in the script is wrong; check that no take says "each call your
officer logs" in a way that implies the per-incident form.

### Not affected

**02, 05, 07, 09, 11, 12, 13, 14, 15, 16** — no behaviour in this window
touches what they narrate.

## Flagged by the 2026-08-15 → 08-16 changes

The window produced one **Wrong** (script 02's auto-save promise), several
**in-script corrections**, and a set of **B-roll / verify** notes.

### 02 — First-Time Setup & Onboarding · **WRONG — corrected in-script 2026-08-16**

The installation wizard's session identifier moved to tab-scoped storage on
2026-08-15. Onboarding is now **one tab, one sitting**: a second tab does not
inherit the run, and closing the browser ends it.

**Chapter 2 promised the exact opposite, on camera.** The Welcome Screen
narration read:

> ~~"The wizard auto-saves your progress, so if you need to step away or your
> browser closes, you'll pick up right where you left off."~~

That is now flatly false, and it was already misleading before 08-15 — the server
session has always expired after 30 minutes idle, so "step away" was never safe
for long. An installer following it would close the browser on purpose,
confidently, and lose the run. Recorded, it would have been the most expensive
kind of error in this series: a viewer does what the narrator told them to and
the product punishes them for it.

**This has been rewritten in `02-first-time-setup-and-onboarding.md` rather than
left in this queue**, per the standing rule that no behavioural content lives
only in SCRIPT_CURRENCY. The replacement narration covers:

- Finish in one tab, in one sitting. Gather the department address, station list,
  apparatus list and first administrator's details **before** starting.
- A second tab starts its own session; the step you were on will refuse to save.
- Closing the browser ends the run. So does 30 minutes idle — the server session
  always expired on a sliding 30-minute timer.
- **The trap worth saying out loud on camera:** reopening the wizard after a
  restart **repaints your typed answers while the session behind them is gone**.
  Nothing warns you until the next step fails. The filled-in form is a local
  draft, not a resumed session — restart the wizard rather than re-typing into
  it.
- "Onboarding has already been completed" is a _different_ message: a department
  already exists, so sign in instead of starting setup.

**B-roll check:** any planned shot showing the presenter leaving the wizard and
coming back must be re-planned — it will now fail on camera, which is either a
ruined take or, if left in, a demonstration of the opposite of what the narration
says. If the shot is kept deliberately as a teaching moment, it needs the
two-frame sequence (repainted form, then the error) rather than a single frame.

**EDITOR:** the replacement is net-longer than the two sentences it removes, so
Chapter 2's `1:00 – 4:00` band and **every chapter marker and clip-table entry
after it** re-time. Budget roughly **45–70 seconds added**, depending on delivery
and on whether the optional two-shot insert is used. Final timecodes are a
recording-production task — narration pacing determines them.

### 01 — Installing The Logbook · **Incomplete — written in-script 2026-08-16**

Chapter 7 hands the viewer to script 02 and explicitly invites them to "jump
ahead and explore on your own" — which is exactly the viewer who will lose a
session. A short form of the caution now sits there: one tab, one sitting, what
to have ready, and the 30-minute idle limit. **No re-timing needed** beyond
Chapter 7's own band; it lands inside an existing chapter near the end.

### 03 — IT Manager · **retired, not applicable**

Flagged on 08-16 alongside 01, then withdrawn on inspection. Script 03 is a
**post-setup** administration guide — it opens with "if you've been handed the
System Owner account" — and has no install walkthrough to attach the caution to.
Its nearest neighbour, the Chapter 9 backup/restore drill, is about restoring a
database, and **a restored install already has an organization, so the onboarding
wizard cannot run against it at all.** Adding the caution here would teach a
constraint the viewer will never meet. Recorded rather than silently dropped, so
the next pass does not re-flag it.

### Any script with full-screen dark-mode B-roll · **B-roll only**

The themed background moved to the root element on 2026-08-15 so it covers the
browser's scrollbar gutter; before that, dark content showed a **15px white strip**
down the right edge (measured against the affected training captures — see
`SCREENSHOT_CURRENCY.md`).

Audio is unaffected — no script describes the page background. **This is a
per-clip edit decision, not a re-record and not a blanket re-shoot.** Note the
trigger is _dark content at the right edge_, not dark mode as such: the same
strip appears on a light page under a **modal overlay**, which is how two of the
three affected training screenshots picked it up.

Since nothing in the series has been recorded yet, the practical action is to
**capture new B-roll against a build dated 2026-08-15 or later** and note it in
the shot list, rather than to audit footage that does not exist.

---

Two items are already **written into the scripts** (same convention as the
08-12 → 08-14 pass — each carries an inline **EDITOR** note at the insertion
point):

| Script | Applied update                                                                                                                                                                          |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **01** | Compose minimum raised to **v2.24.4+** in the prerequisites narration (production override now uses `volumes: !override`); on-screen `docker compose version` output must show ≥ 2.24.4 |
| **12** | New ~15s beat in Chapter 5: pending nominations are member-visible only while the nomination window is open; managers always see the full list. Chapter 5 onward re-times by ~0:15      |

The rest of the window's changes are **B-roll / verify** items — the words in
the scripts remain true, but the screens behind them changed. Nothing is
recorded yet, so these are capture-plan notes, not re-records:

| Script                | Kind                 | What changed on screen                                                                                                                                                                                                                                                                                                                            |
| --------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **04** (Fire Chief)   | B-roll only          | The event-creation Location picker now indents sub-rooms under their container and shows a containment path for a selected nested room (facilities rooms can nest, 2026-08-16). If the demo department has nested rooms, the picker will not look like a flat list. Either seed flat-only demo rooms or let the tree show and don't remark on it. |
| **06** (Member guide) | B-roll only + verify | Member Directory beat (18:00–18:30): a colleague's profile opened from the directory no longer shows MFA/verification/last-login/account timestamps or role permission lists to members — do not capture or gesture at an account-metadata block that is no longer there. The narration as written makes no such claim; keep it that way.         |
| **07** (Secretary)    | B-roll only          | Event form location field — same nested-room picker note as script 04.                                                                                                                                                                                                                                                                            |
| **08** (Short 8AF)    | B-roll only          | Room QR Codes directory: nested rooms display with their containment path, so "search for 'Training Room'" may surface "Training Room — Station 1"-style names. Still correct; choose demo data so the searched name is unambiguous.                                                                                                              |
| **03** (IT manager)   | Verify before take   | If the deployment chapter shows `docker compose` commands or version checks, apply the same v2.24.4+ floor as script 01. Also: `unraid/.env.example` now ships an HTTPS `ALLOWED_ORIGINS` example — any Unraid-flavored aside should not show the old `http://<LAN-IP>` form as the end state.                                                    |
| **All**               | B-roll only          | Dark-mode captures of public pages (forms, ballots, status) render on the themed gradient now, not white — retake any dark-mode public-page B-roll captured before 2026-08-15.                                                                                                                                                                    |

No script narrates facility-room management in enough depth to need a nested
rooms chapter today; if a Facilities deep-dive script is added later, the
walkthrough source is
[`../training/06-apparatus-facilities.md`](../training/06-apparatus-facilities.md#nesting-rooms-inside-rooms-2026-08-16).

## Resolved in-script for the 2026-08-12 → 08-14 changes

The previously flagged material is now written word-for-word in the actual
scripts rather than living only in this queue:

| Scripts    | Applied update                                                                                                                     |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| **01, 03** | Fail-closed TLS, duplicate preflight, single Alembic head, audit legacy boundary, reset ceiling, archive modes, export visibility  |
| **04, 06** | Personal/Organization dashboard scopes, conditional cards, directory/scanner permissions, privacy exports                          |
| **04, 07** | Event reminder audience, defaults, email preferences, 60-minute Flexible window, overlap/guest edges, related-notification cleanup |
| **08**     | New Short **8AF**: Room QR search, PNG/print, rotation invalidation, safe demo handling                                            |
| **12**     | Saved ballot boundaries/settings verification, fresh IDs, frozen roll at issuance/redemption, paper turnout bounds                 |
| **13**     | Store banner, member payment-method change, activity/status counts and filters, recipient privacy                                  |
| **14, 16** | Session requirement/course/program linkage and ownership/cross-org edges                                                           |
| **15, 16** | Point deduction vs overall failure, per-test resume conflicts, server policy and result/export visibility                          |

Every affected file carries an **EDITOR** instruction giving the inserted runtime
and the chapters/clip tables that must be re-timed. Script text is current; final
timecodes remain a production edit because pacing depends on the recorded take.

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

## Flagged by the 2026-08-11 → 08-12 changes

Three things landed that reach the scripts: **saved ballot templates**, a
**security batch** (MFA on OAuth logins, strict refresh rotation, the audit
legacy-hash boundary, an account-reset privilege ceiling), and the
**production compose file now failing closed on transport TLS**. Plus one
purely visual change with wide reach: the **mobile hamburger moved to the
left edge** of the header on every signed-in page.

### 03 — IT Manager / System Admin

**Section: the `SECURITY_REQUIRE_TLS` beat (~35:00, script lines 595–610)** ·
**Wrong.**

The callout — _"Defaults to false so upgrading can't refuse to boot your
instance"_ — is no longer true for the stack this series installs.
`docker-compose.prod.yml` now defaults `SECURITY_REQUIRE_TLS` to **true**, so
an upgrade of the documented production stack running the bundled plaintext
MySQL/Redis **will** refuse to start until the operator either configures
`DB_SSL`/`REDIS_SSL` or writes an explicit `SECURITY_REQUIRE_TLS=false` into
`.env`. The _application_ default is still `false` — the compose file is what
changed — but the narration is delivered over that compose file, so as
recorded it would promise the opposite of what the viewer experiences.
Rewrite the beat as: "the production compose ships fail-closed; here is the
decision it is forcing you to make, and here is how to say 'cleartext, on
purpose' if that is genuinely your situation."

**Consider adding, same chapter:** two 20-second beats for upgraders.
`AUDIT_LOG_LEGACY_MAX_ID` — an upgraded install sets it once to the last
pre-HMAC audit row, or the old rows fail integrity verification (new installs
leave it at 0 and never think about it). And the **account-reset ceiling**:
a `members.manage` holder can no longer reset the password or MFA of an
account holding permissions they lack, which changes who in the department
can "just fix" the chief's locked-out account — the answer is now "someone at
or above that permission level."

### 01 — Installing The Logbook

**Section: the production compose steps (lines ~310, ~408)** · **Incomplete.**

A fresh install following the script verbatim now meets the fail-closed TLS
default the moment it brings up `docker-compose.prod.yml`. Add one beat where
the stack first starts: the app will refuse to boot with the bundled
plaintext database unless you either set up TLS or set
`SECURITY_REQUIRE_TLS=false` explicitly — and saying `false` out loud on
camera should come with the one-sentence caveat about networks you don't
control.

### 12 — Elections Deep Dive

**Section: `BALLOT ITEMS & TEMPLATES` (8:00 – 9:00)** · **Incomplete.**

The template popover now has a second tier above the built-in items: **"Your
saved ballots"** — whole ballots the department saved from previous
elections. This is the feature the annual-officer-election audience actually
wants: build the slate once, click **Save as Template**, and next year apply
it instead of rebuilding. Two things worth saying on camera, because they are
the two questions a secretary will ask: applying one **replaces** the current
ballot (it confirms twice for that reason), and a template carries the
ballot's _structure only_ — never candidates, voters, votes, or attendance,
so last year's nominees do not haunt this year's ballot. Budget ~45 seconds;
it also makes a natural short ("Never rebuild your officer ballot again").

**Section: `CLOSING — INCLUDING EARLY` (26:30 – 27:30)** · **B-roll only.**
The close confirmation is now an in-app dialog whose buttons read **Close
election** / **Keep it open** — any capture of the old browser popup is
stale, and the narration ("confirm") still holds.

**Section: `PAPER BALLOTS, ATTESTATION` (43:00 – 49:00)** · **No change —
recorded here because the narration got _truer_.** The line "No unverified
paper ever slides into a certified total" was written before 2026-08-12,
when a pending batch — excluded from published results — could still steer
**runoff advancement** and **membership-package outcomes** at close. That
gap is fixed; the claim as scripted is now accurate in full. Take it as
written.

**Optional aside, `THE ELIGIBILITY ROSTER` (14:00 – 15:30):** the roster is
now linkable — `/elections/<id>?tab=eligibility` — worth ten seconds when
the narration says "send this to your co-officer."

### 06 — The Member Experience

**Section: login (2:00 – 2:30)** · **Incomplete, one sentence.** The script
already says a 2FA department prompts for the authenticator code after the
password. Add: **this now includes signing in with Google or Microsoft** —
SSO users get the same code screen after the provider hands them back, and
that screen is expected, not an error. (Before 2026-08-12, OAuth sign-ins
skipped the second factor entirely — do not describe the old behaviour.)

**All phone B-roll, this script and every other:** the header ☰ button now
sits at the **top-left**, next to the department name, instead of the far
right. Any phone screen-capture that includes the top bar and was shot
before 2026-08-12 shows the old layout. Same batching advice as the email
B-roll note below: shoot phone-header B-roll last, and re-shoot it as a set.

### 02, 04, 05, 07, 09–11, 13–16

**Checked against the 24-hour diff — no corrections required.** Script 07's
minutes-deletion moments and any delete/confirm interactions across the
series are now in-app dialogs (B-roll formality only; no scripted narration
describes a browser popup). Script 05/16's officer flows are unaffected by
the undated-training fix — no script narrates approving a dateless record
against a freshness-windowed requirement, which is the only path that
changed. Script 02's OAuth module description remains accurate.

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
