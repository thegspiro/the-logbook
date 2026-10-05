# Change audit: October 3 – 4, 2026

Net changes merged to `main` in the 25 hours ending 2026-10-04, written against
`9a1198e7` (PR #2903). **30 non-merge commits, about 20 pull requests**
(#2878 – #2903). One migration in the window, `d058b5e7c1f4` (three nullable
date columns).

> **Gap:** the previous audit stops at 2026-09-23. Commits from 2026-09-24 to
> 2026-10-02 have no audit page, wiki handoff or currency note. This page does
> not cover them.

Roughly half the commits are security-review and app-review passes (forms,
messaging, integrations, reports, onboarding, security-audit IP, scheduled
tasks, locations, course cohorts) whose records live in
`docs/security-review/` and `docs/app-review/`. Wiki handoff:
[`Recent-Changes-2026-10-03-to-10-04`](../wiki/Recent-Changes-2026-10-03-to-10-04.md).

## Read this first

1. **Probationary accounts can sign in and be scheduled** (#2886).
   `User.is_active` meant `status == ACTIVE`; it now covers `(ACTIVE,
PROBATIONARY)` in Python and SQL, shift eligibility, three scheduling rosters
   and the targeted-message recipient filter. An account kept out by being
   probationary can now sign in. Entry in `UPGRADING.md`.
2. **Training requirements can exempt existing members** (#2878). Cutoff date,
   catch-up deadline, "new members only" edits that split a requirement into the
   preserved original plus a copy, and a waive-for-enrolled choice on programs.
   Every grading screen now passes the member's join date and role ids to one
   helper; a sweep test fails on omission. Exports and forecast print N/A where a
   requirement does not apply. Entry in `UPGRADING.md`.
3. **Scheduler claim renewal (CRON-40)** (#2901). Renewal was an unconditional
   `SET`, so a worker that had lost its claim took it back and a second runner
   stayed for the life of the process; four workers meant duplicate reminders.
   Renewal is now an atomic Lua compare-and-extend in `core/background_claim.py`;
   shutdown deletes only a key it still owns. Entry in `UPGRADING.md`.
4. **Course cohort shift** (#2902). CC-5: DST-safe local-time arithmetic; CC-6: a
   finalized class refuses the whole shift before any class moves; CC-7 flagged
   (`KNOWN_LIMITATIONS.md`).
5. **Locations (#2900).** `GET /locations/{id}/display` now redacts
   `event_description` like its public sibling, because it gained a real caller.

## Behaviour and layout changes

| PR                  | Change                                                                                                                                                                                                                                                       |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| #2882               | Equipment checklists: note on a chosen failure, Overall Notes unpinned, one submit toast, Fleet Readiness and My Checklists share a rule, real vehicle types in the builder, unpublish banner, failure-log total fixed, `Organization.active` server default |
| #2880, #2893, #2903 | `card-grid` utility; tablet audit fixes (hover-only actions gated on `pointer-fine:`, `btn-*` inline-flex at every width, Reports date inputs, Kits/Variant Groups, wrapped names); last ten card containers moved to `card`                                 |
| #2890               | Event roster controls 44px on phones; two fills moved onto `btn-info`/`btn-success`                                                                                                                                                                          |
| #2887 – #2889       | Selected toggles use red-800; Training Setup and compliance config fit 320px, contrast and heading fixes, malformed config response handled                                                                                                                  |
| #2891, #2894        | Settings screens regain phone width (`SettingsLayout` `inHub` prop)                                                                                                                                                                                          |
| #2895               | CI: E2E job timeout headroom                                                                                                                                                                                                                                 |

## Documentation and media disposition

**Corrected in this pass**

| Document                                                                 | Change                                                                           |
| ------------------------------------------------------------------------ | -------------------------------------------------------------------------------- |
| `training/02-training.md`                                                | New "Existing Members" section; two cohort edge-case rows                        |
| `training/01-membership.md`, `training/03-scheduling.md`                 | Probationary counts as active                                                    |
| `training/05-inventory.md`                                               | Checklist changes of 2026-10-03                                                  |
| `training/10-mobile-pwa.md`                                              | Phone and tablet layout pass                                                     |
| `UPGRADING.md`                                                           | Three entries: probationary sign-in, requirement exemption, scheduler duplicates |
| `wiki/Module-Training.md`, `Module-Scheduling.md`, `Module-Inventory.md` | Engineering notes                                                                |
| `wiki/Recent-Changes-2026-10-03-to-10-04.md`, `Home.md`, `_Sidebar.md`   | New handoff page and links                                                       |
| `training/SCREENSHOT_CURRENCY.md`                                        | Shots to create and replace                                                      |
| `youtube-scripts/SCRIPT_CURRENCY.md`                                     | Beats now incomplete or stale (scripts 03, 05, 06, 07, 08, 14, 16)               |

**Not edited, deliberately.** `CHANGELOG.md` has been closed to per-change
entries since 2026-09-08 (see `CLAUDE.md`). `DATABASE_SCHEMA.md` was already
regenerated in #2882. Nothing in `APPLICATION_PAGES.md`: no route was added or
retired.

**Not done.** No screenshot was re-shot and no script was rewritten — the lists
above are the work order. The guide 20 index and `docs/training/README.md` were
not extended; the topics went into the module guides directly.
