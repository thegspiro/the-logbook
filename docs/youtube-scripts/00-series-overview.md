# The Logbook — YouTube Tutorial Series Overview

> **Before recording anything, read
> [SCRIPT_CURRENCY.md](./SCRIPT_CURRENCY.md).** It tracks code-to-script drift and
> the recording patches applied before production. As of **2026-08-14**, scripts
> **01, 03, 04, 06, 07, 12, 13, 14, 15, and 16** contain word-for-word August
> release inserts, and Short **8AF** covers Room QR rotation. Editors must apply
> each script's explicit re-timing note before recording.
>
> **2026-09-30:** scripts **01–05** were brought up to date with the releases of
> 24–30 September. Beats that were **wrong** were rewritten in place (listed
> below under "Re-shoot list (2026-09-30)"); each script closes with an editor
> note giving its re-timing.

## Series Structure

This document outlines the complete YouTube tutorial series for The Logbook, an
open-source modular intranet platform for fire departments and emergency
services.

### Deep Dive Videos (Long-Form, 15–30 minutes)

| #   | Title                                         | Target Audience                  | Est. Length |
| --- | --------------------------------------------- | -------------------------------- | ----------- |
| 1   | Installing The Logbook — From Zero to Running | IT admins, self-hosters          | 20–25 min   |
| 2   | First-Time Setup & Onboarding Walkthrough     | Department leadership, IT admins | 15–20 min   |

### Role-Based Guides (Medium-Form, 20–40 minutes each, cuttable into clips)

| #   | Title                                                                   | Target Audience                        | Est. Length |
| --- | ----------------------------------------------------------------------- | -------------------------------------- | ----------- |
| 3   | IT Manager / System Admin — Complete Platform Guide                     | IT managers, system owners             | 35–40 min   |
| 4   | Fire Chief & Department Leadership Guide                                | Chiefs, Deputy Chiefs, Presidents      | 25–30 min   |
| 5   | Training Officer, Part 1 — Building Your Training Program               | Training officers, compliance officers | 13–15 min   |
| 16  | Training Officer, Part 2 — Evaluating, Reporting & Running the Calendar | Training officers, compliance officers | 15–18 min   |
| 6   | The Member Experience — Your Day-to-Day Guide                           | All members, firefighters, engineers   | 22–26 min   |
| 7   | Secretary & Administrative Officer Guide                                | Secretaries, treasurers, admin staff   | 20–25 min   |

> **Scripts 5 and 16 are one guide in two parts.** They were a single 26-minute
> video; it was the longest thing in the series aimed at somebody with a job to do
> that afternoon. The break is at the point where a training officer has something
> to go away and build — their real programs and requirements — rather than
> carrying them through fourteen more minutes of features that need those
> requirements to exist first.
>
> Part 1 sets the system up (dashboard, programs, requirements, recording
> completions). Part 2 uses it (skills testing, compliance reporting, the training
> calendar, and the weekly/monthly/quarterly routine). Publish them a week apart;
> Part 1's close explicitly tells viewers to go and build before starting Part 2.

### Feature Deep Dives (Medium/Short-Form, focused on one subsystem)

| #   | Title                                                                     | Target Audience                                                                                   | Est. Length |
| --- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ----------- |
| 9   | Training Pipelines — An Officer's Guide                                   | Training officers, RTOs/FTOs                                                                      | 21–26 min   |
| 10  | Your Training Pipeline — A Member's Guide                                 | Recruits, probationary & enrolled members                                                         | 8–12 min    |
| 11  | Building a Training Pipeline — Step-by-Step Setup                         | Training officers (first-time setup)                                                              | 12–16 min   |
| 12  | Creating, Running & Auditing Elections — The Complete Guide               | Secretaries, presidents, election admins                                                          | 38–42 min   |
| 13  | The Department Store — Selling Merch Without Becoming a Payment Processor | Quartermasters, secretaries, treasurers, members                                                  | 17–21 min   |
| 14  | Multi-Class Courses & Cohorts — Scheduling a Whole Class Series           | Training officers running recruit schools / academies                                             | 10–14 min   |
| 15  | Skills Testing — Running an Evaluation the Member Can Actually See        | Training officers, evaluators, FTOs/preceptors, EMS officers, **and senior members who evaluate** | 21–25 min   |

> Scripts 9–11 form a **training-pipeline mini-series**: 11 builds a pipeline, 9
> runs it day to day, and 10 shows the member's side. They complement Scripts 5
> and 16 (the broad Training Officer guide) rather than replacing it.

> Script 14 is the scheduling counterpart to Script 11: 11 defines what a recruit
> must _accomplish_ (the pipeline), 14 defines _when the classes meet_ (the course
> syllabus and its cohorts). A department running a recruit school wants both, and
> generating a cohort wires them together.

> Script 13 covers the Department Store end to end — setup, catalog, ordering
> windows, what the store emails and how to preview, test and reword it, the
> member's ordering and paying experience, and PayPal reconciliation. Chapter 6
> overlaps Script 7's administrative material; use whichever suits the
> playlist.

> Script 12 is the canonical elections deep-dive — it supersedes the elections
> chapters in Scripts 4 and 7 and ships with its own **edge-case shorts pack
> (12a–12k)** covering eligibility debugging, test ballots, early-close
> results, receipts, proxies, runoffs, quorum, the rollback rule, dispute
> forensics, voting-method selection, and the pre-meeting package.

> Script 15 is the canonical skills-testing deep-dive, superseding the summary in
> Script 16, Chapter 2. It ships with a **shorts pack (15a–15j)**. Two of those
> shorts — 15f and 15g — describe historical data that was **not** retroactively
> corrected (elapsed times recorded before 2026-08-08, and scorecards altered by
> template edits before the same date), so they are the priority cut for existing
> users rather than for prospects. Chapters 4–7 are entirely new as of 2026-08-08;
> any older skills-testing footage past chapter 3 is out of date.
>
> **⚠ Re-shoot and re-write list (2026-08-17 → 08-19).** Full disposition in
> [`SCRIPT_CURRENCY.md`](./SCRIPT_CURRENCY.md). Five scripts have been
> **rewritten in place** and need re-recording rather than re-queuing — 1, 3, 4,
> 6 and 8. Nothing behavioural from this window is left sitting in the queue:
>
> | What changed                                                                                                                                                                                                                                                       | Footage affected                                                                                                        |
> | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
> | **Shift close-out is a three-step wizard** for departments recording a call count, and the toggle that switches it on sits on the close-out rules card the presenter already stands on                                                                             | Script 4, close-out chapter (rewritten); Script 8, short 8J (shooting note — film it detailed-mode)                     |
> | **The call-volume report says _unit responses_, not calls** — two units on one incident are counted twice until the cross-unit picker ships. A chief narrating "here's your call volume" over that screen is teaching a reporting error with a funding consequence | Script 4, Scheduling Reports (**caveat now written into the take — do not record the old version**)                     |
> | **NFC tags** on event, admin-hours and shift check-in. Needs a real Android phone and a real tag; it cannot be captured in the screenshot harness and a mocked shot will look wrong                                                                                | Script 6, QR chapter (rewritten); Script 8, new short **8AG** (rewritten)                                               |
> | **`python -m app.preflight`** — check the configuration before the restart that would otherwise find out by losing the service                                                                                                                                     | Script 1, new chapter before START THE SERVICES (rewritten); Script 3, two new sections in Chapters 5 and 9 (rewritten) |
>
> The call-volume caveat is the one that is **wrong rather than dated**: pull any
> footage that presents that figure as a department call count.

> **⚠ Priority re-shoot (2026-08-08, later the same day).** The permission model
> changed again after Script 15 was written, and it changes the module's premise
> rather than a detail: **any member can now run an official skills test**, and
> the officer's authority moved to a new **validation** step. This affects
> Script 15 (Chapter 3 opening, the new Chapter 3.5, shorts 15h/15i/15j),
> Script 16 Chapter 2, and Script 6 Chapter 4. Any footage stating that running a
> skills test requires the training-officer permission is now **wrong**, not
> merely dated — pull it before publishing. Shooting Chapters 3, 3.5 and 7 needs
> **three** accounts on screen: a member with no training permissions, a second
> member as candidate, and a training officer.

> **⚠ Re-shoot list (2026-08-09 / 2026-08-10).** Four changes landed that alter
> what is on screen, not merely what is said. Existing footage of these screens is
> stale:
>
> | What changed                                                                                                                                                                                                                                     | Footage affected                                                  |
> | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------- |
> | **The skills-test scoring screen was rebuilt** — candidate name in the header, 44px section chips instead of progress dots, a scored/total count and save-status line, and **Next** as the primary bottom-bar button where **Finish** used to be | Script 15, Chapter 3                                              |
> | **Scheduling Settings moved onto the shared settings layout** — a section sidebar on desktop and a tab strip on phones, replacing the pill tab bar and the two stacked titles. Seven named sections                                              | Script 5; Script 8, short 8j                                      |
> | **Every form control was normalised onto the shared utilities** (2026-08-10) — inputs, selects and checkboxes across 103 files changed padding, corner radius and focus ring, and gained a 44px minimum height on phones                         | **Any close-up of a form on any screen**, across every script     |
> | **Native browser confirm/prompt boxes are gone**, replaced by in-app dialogs whose buttons name the decision ("Keep it" / "Delete") rather than OK/Cancel                                                                                        | Anywhere a script shows a delete, discard, or cancel confirmation |
>
> The first two are structural and worth re-shooting on their own. The third is
> cosmetic per shot but universal, so treat it as a reason to re-shoot a screen
> you are already re-shooting, not a reason to redo the catalogue.

> **⚠ Re-shoot list (2026-09-30).** Full disposition in
> [`SCRIPT_CURRENCY.md`](./SCRIPT_CURRENCY.md). These beats taught something
> that is not true and were rewritten; do not re-use their footage:
>
> | What changed                                                                                                                      | Footage affected               |
> | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
> | **IT & Backup Contacts** has **Skip for now**, and sends no backup access code; module cards use **Enable / Later / Skip**        | Script 2, Chapters 4 and 7     |
> | The top officer is seeded as **Chief**; the logo must be PNG or JPEG; setup ends on **Go to Department Setup**                    | Script 2, Chapters 2, 5 and 11 |
> | The navigation layout is department-wide; there is no per-member override                                                         | Script 2, Chapter 10           |
> | **IP Security** has no allowlists or blocklists — it is country blocking and member-filed exceptions                              | Script 3, Chapter 5            |
> | Session timeout and password policy are environment settings, not a screen; **Create Custom Role**, Priority grants nothing       | Script 3, Chapters 4 and 5     |
> | Event Settings has no QR check-in toggle and no default RSVP deadline; every event gets a QR code                                 | Script 3, Chapter 6            |
> | Every event has a QR code (no toggle); Event Analytics has no per-member view; the report to film is **Certification Expiration** | Script 4, Chapters 3 and 7     |
> | A Training event credits records when its **attendance is finalized**; approval is **Approve and record**                         | Script 5, Chapter 4            |
>
> Script 3 also gains a late-September upgrade section (head `601fdb28ab8c`),
> and Script 1 a `FRONTEND_URL` beat, which a production server now refuses to
> start without.

### Quick Tips / Shorts (1–3 minutes, extracted from role guides or standalone)

| #   | Title                                                                            | Clip Source   |
| --- | -------------------------------------------------------------------------------- | ------------- |
| 8a  | How to RSVP for an Event in 30 Seconds                                           | Script 6      |
| 8b  | Checking Your Training Compliance Status                                         | Script 6      |
| 8c  | Submitting a Shift Swap Request                                                  | Script 6      |
| 8d  | Creating an Event with QR Check-In                                               | Script 4/7    |
| 8e  | Running a Department Election                                                    | Script 4      |
| 8f  | Adding a New Member to the System                                                | Script 3/7    |
| 8g  | Setting Up Two-Factor Authentication                                             | Script 3      |
| 8h  | Viewing the Scheduling Dashboard                                                 | Script 5/7    |
| 8i  | Put Your Shifts in Your Phone Calendar                                           | Script 6      |
| 8j  | Require End-of-Shift Checks Before Finalizing                                    | Script 5      |
| 8k  | Download Everything The Logbook Knows About You                                  | Script 6      |
| 8l  | Why You're Not Getting Department Texts                                          | Script 6      |
| 8m  | You Waived Dues by Mistake — Undo It ⚠️ _(hold: needs the dues UI)_              | Script 7      |
| 8n  | Recording a Dues Payment Twice Won't Charge Twice ⚠️ _(hold: needs the dues UI)_ | Script 7      |
| 8o  | Schedule a Whole Recruit School in One Shot ⚠️ _(planned — not yet scripted)_    | Script 14     |
| 8p  | Reordering Classes Doesn't Reschedule Them ⚠️ _(planned — not yet scripted)_     | Script 14     |
| 8q  | Cohort or Recurring Session — Which Do I Want? ⚠️ _(planned — not yet scripted)_ | Script 14     |
| 8r  | Get Department Alerts on Your Lock Screen                                        | Script 6 / 3  |
| 8s  | Everything's Within Thumb Reach Now                                              | Script 6      |
| 8t  | Fix the Whole CSV Before You Import Anyone                                       | Script 7 / 3  |
| 8u  | Don't Email Sixty People a Password Link by Accident                             | Script 7      |
| 8v  | "Can't Delete This Member" — Here's Why                                          | Script 3 / 7  |
| 8w  | Sign Your Notices With the Right Officer's Name                                  | Script 7      |
| 8x  | An Applicant Can't Read Their Own File                                           | Script 7      |
| 8y  | "Taken Within the Last 180 Days"                                                 | Script 5      |
| 8z  | Your Course Requirement Shows Everyone Incomplete                                | Script 5      |
| 8aa | Change Your Email Footer Once, Not Thirty-Five Times                             | Script 7      |
| 8ab | You Used the Last One — Tell the Truck                                           | Script 6      |
| 8ac | Log a Whole Delivery in One Screen                                               | Script 7      |
| 8ad | Why Your Reorder Alert Never Fired                                               | Script 7      |
| 8ae | Three Boxes, Three Expiry Dates, One Bracket                                     | Script 6      |
| 8af | Print a Room QR Code — and Know When It Stops Working                            | Standalone    |
| 8ag | Tap Instead of Scan                                                              | Script 6      |
| 8ah | Claim a Shift in One Tap                                                         | Script 6      |
| 8ai | Every Tuesday Night, Once                                                        | Script 6      |
| 8aj | Tap Your Card, Walk In                                                           | Script 6      |
| 8ak | The Seal Says Nothing Was Touched — Not That It's Full                           | Script 5      |
| 8al | Print the Roster at the Watch Desk                                               | Script 3      |
| 8am | Who Do I Ask About This?                                                         | Script 4 / 6  |
| 8an | The Ballot That Skipped the Life Members                                         | Script 12 / 4 |
| 8ao | Where Did /testing Go?                                                           | Script 3      |
| 8ap | Build a Check Template in One List                                               | Script 3 / 5  |
| 8aq | Thread Colour on a Brass Plate                                                   | Script 13     |
| 8ar | A Suggestion Box Nobody Can Trace                                                | Standalone    |
| 8as | Label a Whole Storeroom in One Go                                                | Standalone    |
| 8at | Applicants Move When You Close the Event Out                                     | Script 4      |
| 8au | Who's Going — and Where You Stand on the Waitlist                                | Script 6      |
| 8av | Your Old Email Wording Is Still There                                            | Script 7      |
| 8aw | Your Emailed Links Open "localhost"                                              | Script 3      |
| 8ax | Turn Off Just the Emails You Don't Need                                          | Script 6      |
| 8ay | Make an Optional Email Required                                                  | Script 4      |
| 8az | Your Department Already Has a Compliance Box                                     | Script 7      |
| 15a | Your Skills Test Results Are on My Training Now                                  | Script 15     |
| 15b | Void, Cancel, Delete — Which One?                                                | Script 15     |
| 15c | Deliver a Failure in Person                                                      | Script 15     |
| 15d | Your Notes Aren't Always for the Candidate                                       | Script 15     |
| 15e | Stop Losing Scoring When Your Phone Locks                                        | Script 15     |
| 15f | Why Your Old Test Says Seven Hours                                               | Script 15     |
| 15g | Editing a Skill Sheet Used to Rewrite Old Scorecards                             | Script 15     |
| 15h | Any Member Can Run a Practice Test                                               | Script 15     |
| 15i | You Don't Have to Be an Officer to Run a Skills Test _(2026-08-08)_              | Script 15     |
| 15j | You Can't Sign Off Your Own Skills Test _(2026-08-08)_                           | Script 15     |
| 15k | Tap It Again to Clear a Mis-Tap ⚠️ _(planned — 2026-08-09)_                      | Script 15     |
| 15l | "Candidate Did None of These" Is Not a Blank Step ⚠️ _(planned — 2026-08-09)_    | Script 15     |
| 15m | Moving On No Longer Loses Your Stopwatch ⚠️ _(planned — 2026-08-09)_             | Script 15     |
| 12a | "Why Can't This Member Vote?" — Eligibility Debugging                            | Script 12     |
| 12b | Test Ballots — Practice Without Polluting the Results                            | Script 12     |
| 12c | Closed Early? Here's Why Results Are Hidden                                      | Script 12     |
| 12d | Your Vote Receipt — Proof Without Exposure                                       | Script 12     |
| 12e | Proxy Voting in Two Minutes                                                      | Script 12     |
| 12f | Nobody Won — Automatic Runoffs                                                   | Script 12     |
| 12g | Quorum — Making Elections Count (Literally)                                      | Script 12     |
| 12h | Why You Can't Reopen a Closed Election                                           | Script 12     |
| 12i | Investigating a Disputed Election                                                | Script 12     |
| 12j | Choosing a Voting Method                                                         | Script 12     |
| 12k | The Pre-Meeting Package                                                          | Script 12     |
| 13a | Pay Your Store Order From Your Phone                                             | Script 13     |
| 13b | Why There's No Zelle Button                                                      | Script 13     |
| 13c | "I've Sent Payment" Doesn't Mean Paid                                            | Script 13     |
| 13d | Close a Window, Get Your Vendor Order                                            | Script 13     |
| 13e | Let PayPal Mark Your Orders Paid                                                 | Script 13     |
| 13f | Paid But Not Ordered — Why Two Statuses                                          | Script 13     |
| 13g | Your Department's Rule on Unpaid Orders                                          | Script 13     |
| 13h | They Said Venmo and Paid Cash — Record It Right                                  | Script 13     |
| 13i | Tell the Vendor, Tell the Members, One Click                                     | Script 13     |

> **Rows 8aa–8az follow Script 8 as written.** This table used to list eight
> _planned_ shorts under 8aa–8ah; Script 8 later used those letters for the
> shorts above, and the planned ones were never written. They remain ideas, not
> scripts: open-house guest sign-in and the recruiting list (Script 4), every
> Scheduling tab working again and the false "Settings Saved" toast (Script 5),
> emptying a field (Script 3 / 7), reopening an expired enrollment (Script 9),
> checklist steps (Script 10), and deadline-warning schedules (Script 11).

---

## Production Notes

- **Screen captures** should be recorded at 1920x1080, browser in light mode by
  default with a quick dark-mode toggle demo where relevant.
- **Voiceover** should be warm, conversational, and paced for non-technical
  users (fire service audience, not developers).
- Each role-based guide is written with **chapter markers** so it can be:
  1. Published as a single long-form video with YouTube chapters
  2. Cut into standalone 2–5 minute clips for a "Tips" playlist
- **B-roll suggestions** are included in `[B-ROLL: ...]` tags.
- **On-screen text/callouts** are indicated with `[CALLOUT: ...]` tags.
- **Mouse/click actions** are indicated with `[SCREEN: ...]` tags.
- **Transition cues** are indicated with `[TRANSITION: ...]` tags.
