# Change audit: November 2026

One section per documentation pass, newest first. Each pass adds its
section at the top of the current month's file, and a new month starts a
new file. The plain-language handoff for each pass is in
[`wiki/Recent-Changes-2026-11.md`](../wiki/Recent-Changes-2026-11.md).

## Change audit: November 4 – 5, 2026

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
