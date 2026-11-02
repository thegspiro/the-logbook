# Change audit: November 2026

One section per documentation pass, newest first. Each pass adds its
section at the top of the current month's file, and a new month starts a
new file. The plain-language handoff for each pass is in
[`wiki/Recent-Changes-2026-11.md`](../wiki/Recent-Changes-2026-11.md).

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
