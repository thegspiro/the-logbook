# Change audit: November 2026

One section per documentation pass, newest first. Each pass adds its
section at the top of the current month's file, and a new month starts a
new file. The plain-language handoff for each pass is in
[`wiki/Recent-Changes-2026-11.md`](../wiki/Recent-Changes-2026-11.md).

## Change audit: November 1 – 2, 2026

Merged to `main` after `f57fd5a` (2026-11-01 12:47 UTC) through `8700f3cf`
(2026-11-02 15:07 UTC). Security-review passes (scheduling, events-requests,
training-core, training-extended, skills-testing, apparatus-nfc, facilities,
equipment-check-shifts) are in `docs/security-review/PROGRESS.md`.
`CHANGELOG.md` stays closed.

| Change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Guide  | Disposition                                              |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | -------------------------------------------------------- |
| Member performance evaluations ship end to end: screens (3b), supervisor as default evaluator and draft options, signatures, finalization and frozen PDF (4a), email notices and daily reminders (4b), bulk drafting and deletion with a kept record, new `evaluations.delete` (5a), amendment as a new revision (5b), member response and second PDF (5c), calibration flags (5d). Migrations `0ebd6603289b`, `38e0f552242d`, `857291750c67`, `6b2f0c9d4e71`, `9d3a71c5e2b8`, `4c8e2f61a9d7` | 02     | New section written; `APPLICATION_PAGES.md` note updated |
| Evaluated shifts, Transports, Refusals requirement types credited from shift evaluations; offered in the requirement editors                                                                                                                                                                                                                                                                                                                                                                  | 02     | Already described under Shift Evaluations                |
| Member supervisors (Reports To) with dates; finance approval emails record their send and can be re-sent                                                                                                                                                                                                                                                                                                                                                                                      | 01, 11 | Covered by an earlier docs commit (41e4cd45)             |
| Top navigation gains Medical Screening and My ID Card, matching the side layout                                                                                                                                                                                                                                                                                                                                                                                                               | none   | Behaviour fix; parity test added                         |
| Reports and medical-supplies pages no longer crash on a malformed body                                                                                                                                                                                                                                                                                                                                                                                                                        | none   | Bug fix                                                  |
| Dialogs carry `role="dialog"` (#3937)                                                                                                                                                                                                                                                                                                                                                                                                                                                         | none   | Accessibility, no guide text                             |

**Screenshots to create:** see `docs/training/SCREENSHOT_CURRENCY.md`.
**Operator note:** the migration `857291750c67` adds `evaluations.delete` to the
seeded `fire_chief` position; no new environment variables or boot-blocking
changes.

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
