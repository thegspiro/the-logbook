# Change audit: November 2026

One section per documentation pass, newest first. Each pass adds its
section at the top of the current month's file, and a new month starts a
new file. The plain-language handoff for each pass is in
[`wiki/Recent-Changes-2026-11.md`](../wiki/Recent-Changes-2026-11.md).

## Change audit: PayPal Settings, November 14, 2026

A targeted pass for one change: a **Settings** button on a connected PayPal
card, the PayPal counterpart of Zeffy's from November 13. `CHANGELOG.md` stays
closed.

| Change                                                                                                                                                                            | Guide | Disposition                                         |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- | --------------------------------------------------- |
| **Settings** on a connected PayPal card: edit the environment, credentials, Webhook ID and automatic settlement without disconnecting; blank credential boxes keep the saved ones | 16    | Paragraph written; `16-26-paypal-settings` captured |
| Switching PayPal between sandbox and live now needs that environment's Client ID and Client Secret in the same save, on Settings or a reconnect; refused with 422 otherwise       | 16    | Note written; `docs/STOREFRONT_PAYPAL.md` updated   |

**Screenshots:** none queued.

## Change audit: Zeffy Settings and screenshots, November 13, 2026

A targeted pass for the Zeffy follow-ups merged on 2026-11-13: the screenshots
the November 2 pass queued (#4262), and the connect wording and Settings button
(#4268). The rest of what merged since the November 10 – 11 pass is left to the
next full pass. `CHANGELOG.md` stays closed.

| Change                                                                                                                                                               | Guide  | Disposition                                                                                       |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------- |
| Zeffy screenshots: Grants & Fundraising menu, Zeffy page, Link Zeffy campaign dialog, Zeffy connect dialog; integrations catalog re-shot with the Zeffy card (#4262) | 12, 16 | Captured and applied; the Zeffy page shots use a route mock, recorded in `SCREENSHOT_CURRENCY.md` |
| Zeffy and PayPal connect forms no longer claim a key is already stored (#4268)                                                                                       | 16     | `16-24-zeffy-connect` re-shot (#4271)                                                             |
| **Settings** on a connected Zeffy card: change the API key or signing secret without disconnecting; a blank box keeps what is saved (#4268)                          | 16     | Section and troubleshooting rows written in #4268; `16-25-zeffy-settings` captured                |
| Zeffy had no wiki page, and the Grants & Fundraising wiki page did not list `/grants/zeffy` (gap since #3892)                                                        | none   | `wiki/Integration-Zeffy.md` written; module page, sidebar linked                                  |

**Screenshots:** none queued. PayPal still has no **Settings** button, so its
credentials are changed by disconnecting; not documented as a change because
nothing changed.

## Change audit: November 10 – 11, 2026

Merged to `main` after `69d32dc1` (2026-11-10 13:56 UTC, the previous pass)
through `dcc32fe2` (2026-11-11 13:58 UTC), 38 first-parent merges. Sixteen are
security-review passes, recorded in `docs/security-review/PROGRESS.md`; the
forms batches (#4206, #4211, #4239) are recorded in
`docs/FORMS_REVIEW_2026-11-05.md`. `CHANGELOG.md` stays closed.

| Change                                                                                                                                                                                                             | Guide | Disposition                                                                                                                   |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----- | ----------------------------------------------------------------------------------------------------------------------------- |
| Members Administration: **Former Members** page (`?tab=former`) for archived and dropped members; Member Management lists everyone else (#4215)                                                                    | 01    | Added under Member Management Row Actions; Roster row of the hub table and the reactivate note updated                        |
| Member row says each thing once: no base Member chip, no chip repeating the status or class, Status folded into Membership, Reset Password / Unlock / Reset MFA / Delete in a **More actions** menu (#4218, #4222) | 01    | Added; delete steps now point at the menu                                                                                     |
| **Postpone Event** (W80-11): new start and end, reason, clears check-ins and credit, keeps RSVPs, **Postponed** badge on the list (#4179)                                                                          | 04    | New section after Cancelling; wiki `Module-Events` gains the endpoint. Migration `09f0171ccf5e` (three nullable columns)      |
| Evaluations: training-session attendance graded by the member's session-attendance requirement (#4208)                                                                                                             | 02    | Note added to the evaluation steps; wiki `Module-Evaluations` updated. Already in `UPGRADING.md` and `EVALUATIONS_MODULE.md`  |
| Session waiver requests (members ask to be excused), backend only, off until a policy is saved (#4225)                                                                                                             | 02    | "Coming next" note under Waivers. Rules in `backend/app/docs/TRAINING_WAIVERS.md`; migration `8b1cf6f55425` in `UPGRADING.md` |
| Shift history import: overlapping rows get **Save times** in the Times cell (#4190)                                                                                                                                | 03    | Added to the import steps                                                                                                     |
| Training event created and edited with its training details in one save; rolling series and Duplicate carry them (#4231, backend part 1)                                                                           | 04    | Already written by the PR                                                                                                     |
| Community Engagement period report (#4221)                                                                                                                                                                         | 04    | Already written by the PR, also in wiki `Module-Events`                                                                       |
| Noto Sans embedded; certified results, evaluations and minutes as PDF/A-2b (#4207)                                                                                                                                 | none  | Already in `PDF_REPORTS.md`                                                                                                   |
| Sign-in lands straight on **My Account** when a password change or MFA enrolment is due; failed sign-in reselects the password; registry Source link beside Import (#4227)                                         | 00    | Guide 00 already says "straight to the Password tab"; no edit                                                                 |
| Forms batches 4, 16, 17: named missing fields, 422s shown on the field, discard protection                                                                                                                         | none  | Behaviour general across forms; recorded in the forms review                                                                  |
| Dashboard pulse default: audit rows carry IP and browser; buttons offered on either settings permission (A7, #4223)                                                                                                | none  | Recorded in `docs/app-review/`                                                                                                |
| CI: `failOnFlakyTests` (#4219, Pitfall #38), Mobile Safari spec fixes (#4216, #4229), dependency bumps (#4195 pypdf 7.0.0, #4197)                                                                                  | none  | Internal or CI only                                                                                                           |

**Screenshots to create:** Roster strip with **Former Members**; a Member
Management row with the **More actions** menu open; a row reading **No other
positions**; the **Postpone Event** dialog; an event card with **Postponed**;
the event page's "Postponed from" line; a history-import row with **Save
times**. **Replace:** `01-22-member-lifecycle` (shows the old Roster strip and
a separate Status column). Queued in `docs/training/SCREENSHOT_CURRENCY.md`.

**Not covered:** YouTube scripts, flagged in
`docs/youtube-scripts/SCRIPT_CURRENCY.md`, not edited. No script names the
moved row actions or the evaluation figure by label.

## Change audit: November 8 – 10, 2026

Merged to `main` after `51e6e1b5` (2026-11-08 08:59 UTC, the previous pass)
through `69d32dc1` (2026-11-10 13:56 UTC). The plain-language, phone-width and
forms-review sweeps (#4131–#4178) and the security-review and app-review passes
are recorded by their own PRs, `docs/FORMS_REVIEW_2026-11-05.md`, and
`docs/security-review/PROGRESS.md`. `CHANGELOG.md` stays closed.
The November 8 – 9 pass below started from the same commit and covers part of this window; rows that appear in both describe the same changes.

| Change                                                                                                                                                                                                           | Guide | Disposition                                            |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- | ------------------------------------------------------ |
| My Shifts: **Upcoming** under month headers; **Past** by year and month with a Year dropdown and hours chart; declined and cancelled seats leave Past (#4175 area, `674728a5`, `6686002a`)                       | 03    | Added to My Shifts                                     |
| End-of-shift summary rolls call types into counts (`16f5ea1f`)                                                                                                                                                   | 03    | Added                                                  |
| Check In offers **Add a member** after check-in closes (W80-8)                                                                                                                                                   | 04    | Added                                                  |
| Moving an event's start lets reminders resend (W80-16); a training waiver takes an excused drill off "missed" (W80-10)                                                                                           | 04    | Added                                                  |
| Session-attendance requirement with no session held is not graded (W80-9); wizard review lists counted requirements, credit-hours hint, officer check-in starts a record, withdrawn-credit reason (W80-12 to 15) | 02    | Added                                                  |
| Training records show their source: provider, Imported or The Logbook; CSV **Source** column; PDF line under the course (#4209)                                                                                  | 02    | Added to the History tab. No migration                 |
| Member roster is a table again on desktop (`rwd-table-xwide`)                                                                                                                                                    | 01    | Added                                                  |
| `GET /users/with-roles` no longer 500s on a `.invalid` placeholder email (`8cfabeac`)                                                                                                                            | 01    | Added; no migration, write paths still validate        |
| Historical import: members to be created are named as they will be; the already-decided ones fold away                                                                                                           | 16    | Added                                                  |
| PDF margins and Avery 5160 alignment (`21529f7f`)                                                                                                                                                                | none  | Already in `PDF_REPORTS.md` and `KNOWN_LIMITATIONS.md` |
| Shared report layout for training and equipment-check PDFs; escaped text fixed in PDF cells                                                                                                                      | none  | Already in `PDF_REPORTS.md`                            |
| Side-navigation collapse rail keyed on a root attribute, not `:has()` (`08fa40a5`); Mobile Safari E2E run in three shards (#4210); dependency bumps                                                              | none  | Internal or CI only                                    |

**Screenshots to create:** My Shifts Upcoming with month headers; My Shifts Past
with Year dropdown and chart; the event Check In dialog with **Add a member**;
a Training History page showing the source line; a requirement card reading
**No sessions held yet**; Historical Data Import members list with the collapsed
section. **Replace:** `01-01` (roster as a table on a desktop width), `03-04`.
Queued in `docs/training/SCREENSHOT_CURRENCY.md`.

**Not covered:** YouTube scripts, flagged in
`docs/youtube-scripts/SCRIPT_CURRENCY.md`, not edited.

## Change audit: November 8 – 9, 2026

Merged to `main` after `51e6e1b5` (2026-11-08 08:59 UTC, the previous pass)
through `1c15d907` (2026-11-09 07:26 UTC), about 48 merges. Security-review
pass 14 (training core) and the adversarial exfiltration pass (`ADV-01`) are in
`docs/security-review/`. `CHANGELOG.md` stays closed. The training-requirement
delete, milestone, Requests-tab triage and history-import changes were written
into their guides with the code (see the 2026-11-08 notes in guides 02, 03 and
04 and `TRAINING_PROGRAMS`).

| Change                                                                                                                                                                                                  | Guide | Disposition                                                                                                        |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------ |
| **Past** shifts grouped by year and month, Year dropdown, hours-by-month chart                                                                                                                          | 03    | Added under My Shifts. Replace the Past view image                                                                 |
| End-of-shift summary rolls call types up into counts; no longer truncated                                                                                                                               | 03    | Added                                                                                                              |
| Scheduling notification CC boxes refuse non-addresses and duplicates; labelled remove buttons                                                                                                           | 03    | Added                                                                                                              |
| History import: pick an existing agency, new outside units start hidden, catch-all Other                                                                                                                | 03    | Already in the guide                                                                                               |
| Training program wizard keeps a browser draft; **Save draft**, **Start over**                                                                                                                           | 02    | Added after the wizard steps                                                                                       |
| Milestones wait on courses and tests, and choose who is told                                                                                                                                            | 02    | In `TRAINING_PROGRAMS`; pointer added to 02                                                                        |
| Training requirements: usage list, permanent delete, inactive hidden                                                                                                                                    | 02    | Already in the guide                                                                                               |
| Phone and narrow-card reflow of ~20 tables; page-header buttons share rows on a phone; compact empty states                                                                                             | 10    | Added to the mobile guide. No per-screen guide edits                                                               |
| Members see only approved, non-executive meetings (list, detail, MCP tools); draft events hidden server-side                                                                                            | 04    | Added beside the minutes rule                                                                                      |
| Cannot name yourself a supervisor; another member's email change needs step-up and notifies the old address                                                                                             | 01    | Added                                                                                                              |
| Platform analytics: every 30-day figure counts whole local days (W78-4); training waiver takes an excused drill off "missed" (W80-10); moving an event's start lets reminders resend (W80-16)           | none  | Corrections to numbers and reminders; no screen or wording changes                                                 |
| Security: guest lookup answers a member's email as not found; refused sign-ins take one Argon2 verification; inventory socket token no longer accepted in the URL; credential email templates protected | none  | Internal; recorded in the security-review files. Operators using `?token=` on `/inventory/ws` must send the cookie |

**Screenshots to create:** training program wizard with the draft notice; a
phone-width card for one reflowed table (audit log). **Replace:** My Shifts
**Past** view (year dropdown, chart, month headings); Dashboard/Members roster at
narrow width if shown as a table.

**Not covered:** YouTube scripts. They are flagged in
`docs/youtube-scripts/SCRIPT_CURRENCY.md`, not edited.

## Change audit: November 6 – 8, 2026

Merged to `main` after `5607f5fc` (2026-11-06 14:19 UTC, the previous pass)
through `51e6e1b5` (2026-11-08 08:59 UTC), 10 non-security merges. Security-review
passes (scheduling pass 14, events-requests pass 14) are in
`docs/security-review/PROGRESS.md`. `CHANGELOG.md` stays closed.

| Change                                                                                                                                                                                                                                                                                        | Guide  | Disposition                                                                                                                   |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------- |
| **Show required courses (n)** checklist on a Courses requirement card; counts labelled by type ("1/4 courses", no unit for certifications); same unit on Upcoming Due Dates (#4117)                                                                                                           | 02     | Added to the My Training section                                                                                              |
| Member Training History records as a compact list instead of a stacked table (#4114)                                                                                                                                                                                                          | 02     | Added beside the period text; image `02-40` queued                                                                            |
| Zero-hour provider completions take the mapped course's Credit Hours; re-mapping adjusts imported records; migration backfills (#4112)                                                                                                                                                        | 02     | Added to the Integrations tab. `TRAINING_MODULE` and `UPGRADING` written with the change                                      |
| Finance batches 9–11 (owner decisions 2026-11-01): partial amendment reversal and **Pending Amendments** queue, amount paid and receipt before payment, per-type dual approval, **My Dues**, late fees, mileage trip log, shared receipts, board reports, optional live **QuickBooks Online** | 11, 12 | Already in guides 11 and 12, `FINANCE_MODULE`, `Module-Finance` and `UPGRADING`, written with the changes. Screenshots queued |
| Documents, Communications and Integrations batch 8: legal pages render headings and lists, reverts in history, calendar publishing on the integration card                                                                                                                                    | 16, 17 | Already in 16 and 17 and `Module-Governance-Legal`, written with the change                                                   |
| Integration connect, update and disconnect audit rows now record the caller's IP and browser (#4113)                                                                                                                                                                                          | 08     | Audit Log section names the IP column for these events                                                                        |
| Leadership-review time stored in whole seconds so the change notice is not repeated on MySQL 8 (#4116)                                                                                                                                                                                        | none   | Internal; no screen or wording changes                                                                                        |
| Alembic head merges (course hours, QuickBooks), formatting, CI                                                                                                                                                                                                                                | none   | Operator or CI only                                                                                                           |

**Screenshots to create:** a Courses requirement card with **Show required
courses** open; **My Dues**; **Pending Amendments**; the expense line's mileage
trip log; **Mark Paid**; Settings → Connecting QuickBooks Online. **Replace:**
`02-40` (compact record list). Queued in `docs/training/SCREENSHOT_CURRENCY.md`.

**Not covered:** YouTube scripts. They are flagged in
`docs/youtube-scripts/SCRIPT_CURRENCY.md`, not edited.

## Change audit: November 5 – 6, 2026

Merged to `main` after `a02bdd96` (2026-11-05 06:53 UTC) through `880f939b`
(2026-11-06 05:55 UTC), 25 merges. Security-review passes (medical-screening
pass 15, membership-pipeline pass 16) are in `docs/security-review/PROGRESS.md`.
`CHANGELOG.md` stays closed. The 2026-11-05 YouTube-script pass (#4088) and
the Alembic head rejoin (#4060, #4081, #4082, #4085, #4087) were documentation
or operator-only and are not repeated.

| Change                                                                                                                                                                                                                                                              | Guide  | Disposition                                                                                                      |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------- |
| Minutes, Elections & Events batch 7 (#4097): quorum settings (late, left early, **Use proxies**), published attachments and PDF embeds, action-item email, paged Action Items, election rollback files a dated correction, event-request status token hashed        | 04, 14 | Added to 04 and 14; `MEETING_MINUTES_MODULE` and wiki written with the change; `UPGRADING` covers the migrations |
| Member Training History period now scopes totals and list; **Last 12 Months** (#4101)                                                                                                                                                                               | 02     | Export-only wording corrected                                                                                    |
| **Operational members** shortcut no longer ticks Retired (#4100)                                                                                                                                                                                                    | 02     | Already correct in 02; image `02-135` queued                                                                     |
| Admin-hours scan for another category names the running session, **Clock out of** (#4099)                                                                                                                                                                           | 08     | Refusal table row updated                                                                                        |
| Edit a donation (#4090); edit/delete grant budget lines and expenditures; assign a task on create (#4067)                                                                                                                                                           | 12     | "Donations still cannot be edited" corrected in two places; sections added                                       |
| Interviewers see sensitive answers on the Interview page only (#4079)                                                                                                                                                                                               | 15     | Added                                                                                                            |
| Blank first or last name: other fields save, stored name kept, field flagged (#4084)                                                                                                                                                                                | 01     | Added                                                                                                            |
| Sign-in wait counted per account (#4064)                                                                                                                                                                                                                            | 00     | Added                                                                                                            |
| Items and reorder lists reflow to cards below 80rem (#4076)                                                                                                                                                                                                         | 05     | Added                                                                                                            |
| Admin headers unified, **Compliance Settings** title, inset fixes (#4086, #4092); Members roster explains member class (#4091); Card Readers label helper (#4093); Public Requests overview captured (#4085); purple accents and high-contrast switch knobs (#4080) | none   | No guide text quotes the headers; images re-shot by their own PRs                                                |
| Encrypt medical-screening record status at rest (#4083, #4098); backup passes `DB_PORT` (#4081); CI Safari budget (#4082, #4094)                                                                                                                                    | none   | Operator or CI only                                                                                              |

**Screenshots to create:** Minutes Settings → Quorum; roll call with
**Represented by proxy**; admin-hours clock-in page showing the running session;
Edit Donation; grant Budget tab Edit/Delete. **Replace:** `02-40` (Training
History with period-scoped cards), `02-135`, Administration page headers.
Queued in `docs/training/SCREENSHOT_CURRENCY.md`.

## Change audit: November 4 – 5, 2026

Merged to `main` after `9df03d0d` (2026-11-04 12:53 UTC) through `905bd6cf`
(2026-11-05 03:22 UTC), 26 merges. Security-review passes (finance-approvals,
storefront-payments, public-surface-webhooks) are in
`docs/security-review/PROGRESS.md`. `CHANGELOG.md` stays closed.

| Change                                                                                                                                                                                                                                                                                          | Guide                  | Disposition                                                                   |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- | ----------------------------------------------------------------------------- |
| Scheduling batch 4 (#4044): **Require approval for outside-department shifts** with an **Awaiting approval** filter; open-swap bell notice; seats filled by officer override; **Certifications that qualify** per position; seat labels in notices and rosters; close-out capped at 100 credits | 03                     | Added; "There is no approval step" corrected                                  |
| Training batch 4 (#4044): name matching only for older records; cohort wizard fields; editing an approved shift report corrects its credit; students can open a cohort page                                                                                                                     | 02                     | Added; "Students cannot open a cohort page" corrected                         |
| **Session Attendance** requirement and **Counts toward attendance** (#4036, #4039)                                                                                                                                                                                                              | 02                     | Added                                                                         |
| Compliance Settings moved to **Training Admin → Settings & Data** (#4047)                                                                                                                                                                                                                       | 02, 08                 | Path updated in both                                                          |
| Evaluations: counts on tabs, actions in the header (#4011); section grades (#3995)                                                                                                                                                                                                              | 02                     | Header text updated; #3995's grading was already described                    |
| Historical Data Import parts 3–4: training records, and **Shift & Call History** on the member profile (#4033, #4029)                                                                                                                                                                           | 01, 02, 16             | Sections added; 16's TOC extended                                             |
| Dashboard review fixes (#4050): Department pulse, **Today**, **All clear · n checks**, **None scheduled**, Scheduling Operations defaults                                                                                                                                                       | 00, 08                 | Added                                                                         |
| Members batch 3 (#4024): tier names for every member, tier rules follow membership status, supervision loops refused, **My Crew**, starting status tiers; medical screening grace periods, detail permission and linked requirements                                                            | 01, 04, 08, 13, 14, 15 | Added; 13's "type 0 saves 30" and prospect-screening contradictions corrected |
| Toggle tracks on touch (#4048); "Draft saved" on an unchanged purchase request (#4037); Move tag and Card Readers wording (#4035); Public Information on the legacy onboarding path (#4010)                                                                                                     | none                   | No guide text quotes these                                                    |
| Operator-facing: alembic head merges (#4025, #4041), workflow-review seed (#4045), Dependabot (#4026, #4027, #4028)                                                                                                                                                                             | none                   | `UPGRADING` entries for #4024 and #4044 written with the changes              |
| Docs merges (#4032, #4038, #4042)                                                                                                                                                                                                                                                               | none                   | Already documentation                                                         |

**Screenshots to create:** Scheduling **Awaiting approval** filter; Session
Attendance requirement form; Historical Data Import training section; profile
**Shift & Call History**. **Replace:** Training Admin Settings & Data (Compliance
Settings card); dashboard Department pulse and Today's Staffing; Medical
Screening requirement badge. See `docs/training/SCREENSHOT_CURRENCY.md`.

**Not covered:** YouTube scripts. None describes these screens.

## Change audit: November 5, 2026 (later merges)

The pass above stops at `905bd6cf`. This one covers what merged after it, through
`a02bdd96` (2026-11-05 06:53 UTC), and adds changes both passes had missed.
Merged to `main` after `c1cd3492` (2026-11-04 14:21 UTC, the previous pass)
through `a02bdd96` (2026-11-05 06:53 UTC). It also picks up three changes that
merged in that range but were not described before: grading by section,
Members batch 3 and the shift and call history. Security-review passes
(public-surface-webhooks, storefront-payments, finance-approvals,
elections-ballots, users-organizations; all 0 fixed) are in
`docs/security-review/PROGRESS.md`. `CHANGELOG.md` stays closed.

| Change                                                                                                                                                                                                    | Guide  | Disposition                                                                                                                                                                 |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Session Attendance** requirement type; sessions link at creation; **Counts toward attendance** badge; the Chief's override (#4033 range, #4044)                                                         | 02, 04 | New "Session attendance requirements" section in 02; badge noted in 04; `Module-Training` wiki written. `UPGRADING` covers the migrations                                   |
| **Compliance Settings** listed under Settings & Data; **Configure** hidden from `training.manage` alone                                                                                                   | 02     | Area table and "older version" list corrected                                                                                                                               |
| Import from Registry moved below the requirements list                                                                                                                                                    | 02     | Added                                                                                                                                                                       |
| Evaluations **graded by section** with grade ranges and evaluator regrade; header counts and actions                                                                                                      | 02     | New "Grading by section" and header subsections; `Module-Evaluations` wiki written                                                                                          |
| Historical import: **training rows** and **company drills** become held sessions                                                                                                                          | 16     | Added; wiki page corrected (it said drills were "a later step")                                                                                                             |
| Members batch 3: **My Crew**, profile **Shift & Call History**, "Member since" from credited service                                                                                                      | 01, 03 | Added to 01 and 03                                                                                                                                                          |
| Medical screening: **grace period now applied**; new `medical_screening.view_details`; records count only for their linked requirement                                                                    | 13     | **Corrected.** Guide 13 and `Module-Medical-Screening` said the grace period was not applied; the Grace Period section, permissions table and worked example were rewritten |
| Scheduling batch 4: custom seats seatable by an officer with a reason; outside shifts can require approval; open-swap bell entry                                                                          | 03     | Added; `Module-Scheduling` wiki written                                                                                                                                     |
| Skills evaluations unsent at automatic sign-out are kept 7 days for the same examiner                                                                                                                     | 09, 10 | Corrected: both said unsent work was deleted at sign-out                                                                                                                    |
| Inventory batch 5: unique sibling category names, item dates checked against the department's date, Unassign dialog, creation counts as a sighting                                                        | 05     | **Corrected:** 05 said an item added today is "Never" in Items Not Seen                                                                                                     |
| Fundraising: **Edit** on donors and campaigns                                                                                                                                                             | 12     | Added                                                                                                                                                                       |
| Dashboard: department pulse on My Department, All clear fold, real-value Scheduling filters, 24-hour shift times, phone open-shift count, notification stack preview                                      | 00     | Added to "What's on the dashboard"                                                                                                                                          |
| Event settings regrouped as **Public Requests**; Handling step amber until a coordinator is set                                                                                                           | 04     | Handling note added (the regroup itself was documented in the previous pass)                                                                                                |
| Wide tables reflow to cards by their card's width (80rem and 96rem tiers; ten finance tables, training history, minutes attendance, pledges, tap log and others); switch tracks fixed on touch            | 10     | Added to "On a Tablet"                                                                                                                                                      |
| Location pickers and Card Readers stop repeating a room's building; applicant board selection box no longer covers card content; purple switches use the theme red                                        | none   | No guide text describes these; screenshots queued                                                                                                                           |
| Operator-facing: DigitalOcean and Google Cloud deployment guides; container services removed from the supported-platform list; workflow-review seed steps up first; migration heads rejoined (five times) | none   | Deployment docs written with the changes                                                                                                                                    |

**Screenshots to create:** requirement form with Session Attendance; create-session
attendance checklist; Compliance Matrix Chief override and **Met by the Chief's
override**; **Counts toward attendance** badge; grading-by-section builder and
evaluation page; Settings & Data → Compliance Settings; Historical Import training
set-up and drill step. **Replace:** any screenshot showing a toggle switch (ovals on
touch, purple); the dashboard captures `00-24` and `00-25`; Items Not Seen
(`05-127`); medical screening Martinez rows; the event form and Create Training
Session location pickers. See `docs/training/SCREENSHOT_CURRENCY.md`.

**Not covered:** `docs/training/21-october-2026-release-changes.md` is a frozen
release summary; November changes are in the guides above. YouTube scripts are
flagged in `docs/youtube-scripts/SCRIPT_CURRENCY.md`, not edited.

## Change audit: November 3 – 4, 2026

Merged to `main` after `12f1430d` (2026-11-03 16:55 UTC) through `9df03d0d`
(2026-11-04 12:53 UTC). Security-review passes (scheduled-tasks, locations-kiosk,
core-infra, frontend-shared, cross-cutting baseline and pass 15, auth-session,
permissions-roles; 0–2 fixes each) are in `docs/security-review/PROGRESS.md`.
`CHANGELOG.md` stays closed.

| Change                                                                                                                                                                                                        | Guide      | Disposition                                                                                                              |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------ |
| **Historical Data Import**: shift, on-call and administrative hours from one export, reviewed in monthly batches (#4013, #4015)                                                                               | 16         | Section added to 16; wiki page `Integration-Historical-Data-Import` written with the change                              |
| Interviewers are emailed when an applicant reaches an Interview Requirement stage (#4012 range); **My applicants** narrows counts and archive tabs                                                            | 15         | Added; `PROSPECTIVE_MEMBERS_MODULE.md` written with the change                                                           |
| One **Evaluations** navigation entry; first-time setup checklist, preview and two starter templates                                                                                                           | 02         | Added (02's "Where things are" table extended)                                                                           |
| Setup asks about **Public Information**; a lapsed setup session shows a banner; Public Information stays on by default                                                                                        | 00         | Wiki `Onboarding` and `ONBOARDING_FLOW` written with the change; guide 00 does not describe the Modules step, so no edit |
| **Send as me** confirmation now names what happens to equipment checks                                                                                                                                        | 10         | Resolves the item raised on Nov 2 – 3; guide 10 already matched                                                          |
| Paused shift patterns listed on Shift Patterns so they can be resumed                                                                                                                                         | 03         | Guide already described Paused and Resume; the behaviour now matches it                                                  |
| Members hub reads screening standing from the Compliance tab ("N of M compliant")                                                                                                                             | 13         | Hub tile and queue wording changed; guide 13 does not quote the old tile                                                 |
| Event QR page reports guest check-in correctly; roster reflows to cards below 1024px; compact empty state in profile ID Cards; applicant follow-up form no longer redirects a signed-out applicant to sign in | 01, 04, 15 | No guide text describes these                                                                                            |
| Operator-facing: `REDIS_REQUIRED=true` refuses to start without Redis; images on tested runtimes and a combined Unraid image; eight unused tables dropped; Azure deployment guide                             | none       | `UPGRADING`, `DOCKER-BUILD-PUBLISH`, `DATABASE_SCHEMA_DRIFT`, `deployment/azure` written with the changes                |

**Screenshots to create:** Historical Data Import (upload, column mapping, sorted
rows, batch list); the **Evaluations** strip and Getting started checklist with
preview. **Replace:** `01-22-member-lifecycle` and any Members roster capture
at tablet width (cards below 1024px); profile ID Cards empty state. See
`docs/training/SCREENSHOT_CURRENCY.md`.

**Not covered:** YouTube scripts. None describes these screens.

## Change audit: November 2 – 3, 2026

Merged to `main` since `8700f3cf` (2026-11-02 15:07 UTC) through `12f1430d`
(2026-11-03 16:55 UTC), 36 merges. Security-review passes (compliance,
admin-hours, grants-fundraising, medical-supplies, meetings-minutes with MM5-4
resolved, messaging-notifications) are in `docs/security-review/PROGRESS.md`;
app-review pass 6 (A1 storefront, A2 auth and session, A3 scheduled tasks, A4
email templates) is in `docs/app-review/PROGRESS.md`. Three documentation
merges (#3941, #3942, #3943) and the screenshot capture (#3959) landed in this
window. `CHANGELOG.md` stays closed.

| Change                                                                                                                                                                                                                                                                                                                                     | Guide  | Disposition                                                                                                                                                                             |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **History** module: past members, the **Honor Roll**, titles, and a clearance review before a record goes public; three History permissions held by the seeded Historian (#3966, #3967)                                                                                                                                                    | 01     | Added a History section; `HISTORY_MODULE.md` and `KNOWN_LIMITATIONS` written with the change. Corrected 01's anonymizing paragraph: a History record is not anonymized with the account |
| Leave shown beside training hours; a department **Months on leave** rule, **Full month (default)** on upgrade; shift and call targets round down (#3958)                                                                                                                                                                                   | 02, 03 | Added; the 15-day sentences in 02 and 03's 6-shift example corrected. `UPGRADING` entry added (standing can change on upgrade)                                                          |
| Shift evaluations on an outside agency's units, switched on per agency (#3956)                                                                                                                                                                                                                                                             | 02, 03 | Added; 02's "Submit locks the evaluation" corrected (a submitted evaluation can still be edited)                                                                                        |
| **Adopt Minutes** also approves the meeting; existing meetings with adopted minutes are approved on upgrade (#3972)                                                                                                                                                                                                                        | 04     | Added. `UPGRADING` entry added                                                                                                                                                          |
| Labels: **Printer resolution** per label size; the overdue gear email goes at most once a day (#3971, #3961)                                                                                                                                                                                                                               | 05     | Added                                                                                                                                                                                   |
| Queued equipment checks and skills scoring send by Background Sync where the browser supports it; the offline lesson updated (#3952, #3969)                                                                                                                                                                                                | 10, 09 | Added; guide 10's claims that shift reports send only from their own tab, and the shift-report toast text, corrected                                                                    |
| A member off the frozen voter roll is told the rule they still fail (#3949)                                                                                                                                                                                                                                                                | 14     | Added                                                                                                                                                                                   |
| Medical screening: failed results count, a prospect's screenings carry into membership (#3945)                                                                                                                                                                                                                                             | 13     | Written with the change                                                                                                                                                                 |
| File types named ("PDF", "Word") (#3954); shift notice dates printed as "Sep 30, 2026" (#3951); my-attendance answers null for a member not checked in (#3950); a password-reset link used twice at once works once (#3953); grids sized by their own width (#3957); a check that fails on any query comparing an encrypted column (#3970) | none   | No guide text describes these                                                                                                                                                           |
| Housekeeping: Alembic heads rejoined (#3960, #3963, #3965, #3967), dependency bumps (#3944, #3946, #3947, #3948), lockfile metadata (#3977)                                                                                                                                                                                                | none   | No guide change                                                                                                                                                                         |

**Raised with the owner, not fixed here:** the **Send as me** confirmation
(`HeldOfflineItemsNotice.tsx`) still says equipment checks and shift reports
send "the next time you open their page", which #3952 made untrue.

**Screenshots to create:** the History overview, a past-member page, the Honor
Roll, Titles and clearance, and a clearance review; **Months on leave** on the
Thresholds tab and the member Training History **Requirements** section; the
per-agency **Evaluate shifts on _agency_'s units** box and an evaluation badge;
**Printer resolution** on the label page. **Replace:**
`02-108-monthly-hours-leave` (an excused month now keeps its hours). See
`docs/training/SCREENSHOT_CURRENCY.md`.

## Change audit: November 1 – 2, 2026

A top-up pass for the merges after `f57fd5a` (2026-11-01 12:47 UTC) through
`8700f3cf` (2026-11-02 15:07 UTC) that the two passes below did not cover.
Member performance evaluations and the Reports and Medical Supplies crash fix
are in the evaluations pass, and Zeffy in its own. Security-review passes
(scheduling, events-requests, training-core, training-extended,
skills-testing, apparatus-nfc, facilities, equipment-check-shifts) are in
`docs/security-review/PROGRESS.md`. `CHANGELOG.md` stays closed.

| Change                                                                                                                       | Guide  | Disposition                                  |
| ---------------------------------------------------------------------------------------------------------------------------- | ------ | -------------------------------------------- |
| Evaluated shifts, Transports, Refusals requirement types credited from shift evaluations; offered in the requirement editors | 02     | Already described under Shift Evaluations    |
| Member supervisors (Reports To) with dates; finance approval emails record their send and can be re-sent                     | 01, 11 | Covered by an earlier docs commit (41e4cd45) |
| Top navigation gains Medical Screening and My ID Card, matching the side layout                                              | none   | Behaviour fix; parity test added             |
| Dialogs carry `role="dialog"` (#3937)                                                                                        | none   | Accessibility, no guide text                 |

**Screenshots to create:** see `docs/training/SCREENSHOT_CURRENCY.md`, which
also queues the evaluation screens the evaluations pass named.

## Change audit: Zeffy integration, November 2, 2026

A targeted pass for one merge: the Zeffy integration (#3892, merged
2026-11-01 18:23 UTC), which landed after the previous pass's range closed at
`f57fd5a`. The rest of what merged since is left to the next full pass.
`CHANGELOG.md` stays closed.

| Change                                                                                                                                                                                                           | Guide | Disposition                                                            |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- | ---------------------------------------------------------------------- |
| Zeffy integration card: API key, optional webhook signing secret, signed webhook, hourly sync of linked campaigns (#3892)                                                                                        | 16    | Section written; catalog row and troubleshooting rows added            |
| **Grants & Fundraising → Zeffy**: linking a Zeffy campaign to a fundraising campaign, fundraising event or dues schedule, the start date, the payments list and its eight statuses, refunds and disputes (#3892) | 12    | Section written; menu list, events note and troubleshooting rows added |
| Zeffy membership payments credited to member dues (method `zeffy`, reference `zeffy:`); dues link needs both finance permissions (#3892)                                                                         | 11    | Note added under Recording Payments                                    |
| Setup and operator detail: `docs/ZEFFY_INTEGRATION.md`; owner decisions in `docs/KNOWN_LIMITATIONS.md` (#3892)                                                                                                   | none  | Already written with the change                                        |

**Screenshots to create:** Zeffy card and connect dialog; the Zeffy page; the
link dialog. **Re-check:** the Grants & Fundraising menu. See
`docs/training/SCREENSHOT_CURRENCY.md`.

## Change audit: member performance evaluations, November 1–2, 2026

A pass scoped to one feature: the member performance evaluations PRs, merged
between #3888 and #3938. **Other merges after `f57fd5a` are not reviewed here**
and remain for the next full pass. The October 31 row "storage tables only,
nothing reads them yet (#3875)" is superseded: the screens have shipped.

| Change                                                                                                                                                             | Guide | Disposition                                                           |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----- | --------------------------------------------------------------------- |
| Evaluation templates (form builder, workflow steps, publish) and review periods; `evaluations.configure` and `evaluations.manage` given to the Chief (#3888)       | wiki  | `wiki/Module-Evaluations.md` and `docs/EVALUATIONS_MODULE.md` written |
| Drafting, the figures snapshot and coverage, parts, who sees what, calibration; `evaluations.conduct` and `evaluations.view_all` given to the Chief (#3921, #3925) | wiki  | Same pages                                                            |
| Signing with typed name and step-up, finalization, the frozen PDF (#3928)                                                                                          | wiki  | Same pages; step-up table in Security-Authentication                  |
| Seven editable evaluation emails, daily reminders and overdue notices; new email kinds "Your performance evaluations" (required) and "Evaluation duties" (#3929)   | wiki  | Same pages                                                            |
| Bulk drafting a review period; deletion with a kept record and `evaluations.delete` given to the Chief (#3933)                                                     | wiki  | Same pages                                                            |
| Amending a finalized evaluation as a new revision (#3936)                                                                                                          | wiki  | Same pages                                                            |
| The member's written response with a second PDF; calibration flags (#3938)                                                                                         | wiki  | Same pages                                                            |
| Reports page crash on an unexpected report payload; medical supplies storage list (#3926)                                                                          | none  | Bug fix; no guide text described the failure                          |

**Screenshots to create:** Member Evaluations (templates and periods); template
builder (sections, items, workflow); Evaluations list and Draft a review
period dialog; evaluation page as evaluator, as member, and after
finalization; sign dialog; calibration dialog; amend and delete dialogs; My
Evaluations with a deleted-evaluation record; the evaluation PDF. See
`docs/training/SCREENSHOT_CURRENCY.md`.

## Change audit: October 31 – November 1, 2026

Merged to `main` after `f9220b3` (2026-10-31 00:40 UTC) through `f57fd5a`
(2026-11-01 12:47 UTC). Security-review passes (storefront-payments,
public-surface-webhooks, finance-approvals, elections-ballots,
users-organizations, membership-pipeline) are in
`docs/security-review/PROGRESS.md`. `CHANGELOG.md` stays closed. The previous
pass's merge (#3873) went in at the same moment as #3866 and #3872, so those two
are covered here.

| Change                                                                                                                                                                                                                                                         | Guide | Disposition                                              |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- | -------------------------------------------------------- |
| Case managers and interviewers on an applicant, **My Applicants**, new `prospective_members.view_all` (migration gives it to every position holding view or manage); case managers may withdraw; interviewers no longer see coordinators' notes (#3872, #3876) | 15    | Section written; permission also in the wiki Role System |
| Shift evaluation templates (Training Admin → Shift Evaluations), program form picker, general form (#3884)                                                                                                                                                     | 02    | Section written                                          |
| Shift evaluations on shifts: per-member evaluation page from the Shift Completion Report, print view, encrypted ratings (#3902)                                                                                                                                | 02    | Section written                                          |
| Member performance evaluations: storage tables only, nothing reads them yet (#3875)                                                                                                                                                                            | none  | Nothing to document until screens ship                   |
| Scheduling: occurrence ledger (deleted or moved generated shift is not recreated), skipped-seat notice, Drives-apparatus custom seats, reviewer role in effect, department defaults, attendance unique per member per shift (#3881)                            | 03    | Already in guide 03 and the wiki; no new edit            |
| Shift swap times sent with a UTC offset; board no longer offers seats on approved time off (#3882)                                                                                                                                                             | 03    | Time-off behaviour already in 03                         |
| Member profile leaves badged by their dates; directory no longer requests the manager-only tier config (#3886)                                                                                                                                                 | 01    | Note added                                               |
| Elections: Escape keeps the create form, future waiting date refused (#3885)                                                                                                                                                                                   | 14    | Behaviour, no guide text described it                    |
| Onboarding W01-12 to W01-16: backup recovery email must differ from the administrator's, 44px targets, label fixes (#3877, #3874)                                                                                                                              | 00    | Re-check onboarding screenshots                          |
| Public portal: guest QR double scan counts one attendee (#3880)                                                                                                                                                                                                | none  | Backend fix                                              |
| Shared-device push leaks, push links, stuck push toggle (#3866)                                                                                                                                                                                                | 10    | No guide text; behavioural fix                           |
| Refusal-message sweep, auth coverage, date-in-timezone tests, mypy fix                                                                                                                                                                                         | none  | Test and CI only                                         |

**Screenshots to create:** My Applicants; case-manager status dialog; Shift
Evaluations settings and form editor; program form picker; report evaluation
status lines; evaluation page; evaluation print view. **Re-check:** member
profile leave badges; onboarding IT Contacts step; Scheduling Department
Defaults card (overtime field removed). See
`docs/training/SCREENSHOT_CURRENCY.md`.
