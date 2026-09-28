# Workflow Review — W07 Dashboard for Each Role

**Driven:** 2026-09-28 · **As:** all ten seeded roles · **Viewports:** 1280×900, 390×844
**Commit:** `8cc8c30` plus this run's fixes (re-driven) · **Database:** continued from W06; no reset

---

## What was driven

1. Signed in as each of the ten roles in turn:
   - `admin`, `chief`, `training_officer`, `secretary`, `treasurer`, `quartermaster`, `scheduling_officer`, `membership_coordinator`, `member`, `member2`.
2. For each role:
   - Loaded `/dashboard` and waited for it to settle.
   - Searched the page for "undefined", "NaN", "Invalid Date", `[object Object]` and raw ISO timestamps, and for any error line.
   - Followed every in-app link on the page, recording each one that led to "Access Denied", a disabled module, a missing page or an error boundary.
   - Collected every `4xx`/`5xx`, console error and page error across the whole pass.
3. The W07 lead: as `admin`, turned the Integrations and Scheduling modules off. Loaded the dashboard, Members Administration and My Account, then turned both back on.
4. `admin` and `member` at 390×844.

## Held up ✅

- **Every role's dashboard loaded cleanly** with all modules on:
  - no failed request;
  - no console or page error;
  - no broken text;
  - no error line.
- **Every dashboard link opened a page the role can use**: 9 links for `admin`, 1 for `member`, 42 across all ten roles, none refused or missing.
- **The summary cards are gated per role**, and the gates hold:
  - Only `admin` and `treasurer` see the money cards (Dues, Cash flow, Budget threshold), behind `finance.manage`.
  - The grant cards (Grant deadlines, Application stages, Campaign progress) show for roles holding `fundraising.view`.
  - The outreach cards show for roles holding `events.manage`.
  - `member`, `member2`, `quartermaster` and `membership_coordinator` see only their own cards: Next 30 Days, My Updates and My Hours. Read from code, the backend applies each permission and the module switch (`dashboard.py`, `get_main_dashboard_widgets`).
- **At 390px:** no sideways scroll, no control under 44px and no unnamed control, for `admin` and `member`.

## Findings

### W07-1 — LOW — Turning a module off made every page fire 403s — ✅ FIXED

**Did:** as `admin`, turned Integrations and Scheduling off, then opened the dashboard, Members Administration and My Account.
**Saw:** 10 `403`s across those three pages:

- `GET /integrations/connected` on every page, several times per page;
- `GET /scheduling/settings` on the dashboard.

Nothing on screen was wrong, because both failures were swallowed. But each is a refused request in the server logs for every page every member opens. This confirms the W07 lead from the first browser pass.
**Where:**

- `useConnectedIntegrations`, called by both `TopNavigation` and `SideNavigation` to decide whether to show the ID-card link.
- `useSignupWindow`, called by `Dashboard`.

Neither checked the module switch before asking.
**Fix:**

- Both hooks take an `enabled` option.
- The navigation passes the Integrations switch, and the dashboard passes the Scheduling switch. Both wait for the module list to load, so nothing fires in the moment before the switches are known.

Re-driven:

- With the modules off, the same three pages made no failed request.
- With them on, each endpoint was called once with `200`.

Tests: `useConnectedIntegrations.test.ts`, `useSignupWindow.test.ts`.

## Checklist

| Section                 | Result                                                         |
| ----------------------- | -------------------------------------------------------------- |
| 1. The job gets done    | ✅ every role's dashboard loads; every link works              |
| 2. The right people     | ✅ summary cards follow the permission and module gates        |
| 3. Wrong input, failure | n/a — the dashboard takes no input beyond the period select    |
| 4. Browser signals      | ✅ after W07-1; clean with all modules on                      |
| 5. Coming back to it    | ✅ reload is the load; links return normally                   |
| 6. On a phone           | ✅ no overflow, no small or unnamed controls                   |
| 7. Everyone can use it  | ✅ no unnamed controls                                         |
| 8. What happens around  | ✅ dates read "September 28", "3 hours ago"; no raw timestamps |

## Completion gate

| Check                    | Result                                                                    |
| ------------------------ | ------------------------------------------------------------------------- |
| npm run typecheck        | ✅ clean                                                                  |
| npm run lint             | ✅ clean                                                                  |
| flake8 (changed files)   | n/a — no Python changed                                                   |
| black --check            | n/a                                                                       |
| frontend tests (touched) | ✅ full suite: 604 files, 8195 tests; the new cases failed before the fix |
| backend tests (touched)  | n/a                                                                       |
