# Change audit: November 2026

One section per documentation pass, newest first. Each pass adds its
section at the top of the current month's file, and a new month starts a
new file. The plain-language handoff for each pass is in
[`wiki/Recent-Changes-2026-11.md`](../wiki/Recent-Changes-2026-11.md).

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
