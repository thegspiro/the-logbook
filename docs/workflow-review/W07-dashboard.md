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

---

## Second pass — the dashboard after its November redesign (2026-11-08)

**Driven:** 2026-11-08 · **As:** all ten seeded roles · **Viewports:** 1280×900, 390×844
**Commit:** `8d25882` plus this pass's fix · **Database:** continued from the W06 second pass; no reset

The owner asked to continue with W07. Since the first pass, the dashboard was
redesigned (2026-11-05):

- a Personal view everyone lands on;
- a **My Department** tab for leaders, with the department pulse;
- scheduling-widget filters taken from real values;
- all-clear operations sections folded into one line.

The W01 lead about Training being asked while switched off was also open.

### What was driven

1. For each of `admin`, `chief`, `training_officer`, `secretary`, `treasurer`, `quartermaster`, `scheduling_officer`, `membership_coordinator`, `member` and `member2`:
   - loaded `/dashboard`, then the My Department tab where the role has one;
   - searched each tab for "undefined", "NaN", "Invalid Date", `[object Object]` and raw ISO timestamps;
   - followed every in-app link on the tab, recording any that led to "Access Denied", a switched-off module, a missing page or an error boundary;
   - collected every `4xx`/`5xx` and console error.
2. The open lead: as `admin`, switched Training off. As `admin`, `training_officer` and `member`, loaded the dashboard (both tabs), Members Administration and My Account, collecting every failed call. Then switched Training back on.
3. `admin` (both tabs), `member` and `treasurer` at 390×844.

### Held up ✅

- **Every role's dashboard is clean on every tab:** no failed request, no console error and no broken text, for all ten roles.
- **Every link opens a page the role can use:**
  - `admin` has 2 on Personal and 9 on My Department;
  - `chief` 2 and 6, `secretary` 2 and 6, `training_officer` 1 and 5;
  - `treasurer` has 7 on Personal;
  - `scheduling_officer` 1 and 3, `membership_coordinator` 2 and 1, `quartermaster` 1 and 0;
  - `member` and `member2` have 1 each.

  None was refused, switched off or missing.

- **Personal first:** everyone lands on Personal, with Next 30 Days, My Updates and My Hours. Department-wide data loads only when a leader opens My Department.
- **My Department is gated per role:**
  - `admin` sees the pulse plus the money, grant, outreach, scheduling and assets sections;
  - `chief` and `secretary` see everything but money;
  - `quartermaster` sees only Assets & operations, and `membership_coordinator` only Membership health.
- **The W01 lead is resolved:** with Training off, none of the three roles' dashboards, Members Administration or My Account asked a Training endpoint. There were no 403s.
- **Phone:** no sideways scroll, and no control under 44px except the inline "Set it up now" link, which is exempt. Every control is named.

### W07-2 — LOW — The two-factor notice sent members to "Profile > Security" and the profile tab — ✅ FIXED (test-proven)

**Saw:** the `admin`'s My Updates said "You have 14 days to set it up under Profile > Security". The notice's link is `/account`, which opens the Account (profile) tab. The screen is called My Account, and two-factor setup is on its Security tab. W05-11 fixed the same destination on the grace banner. Two more places named screens that don't exist:

- the step-up error for an account with no password said "under Profile > Security";
- the `LB-AUTH-005` support entry pointed administrators at "Organization Settings → Security", which isn't a section. The MFA policy is under Settings → Authentication → MFA Policy.

**Where:** `_announce_mfa_grace` (`backend/app/api/dependencies.py`), `step_up` (`auth.py`), `ERROR_CODE_CATALOG` (`core/error_codes.py`) and `docs/ERROR_CODES.md`.
**Fix:**

- the notice says "My Account > Security" and links to `/account?tab=security`;
- the step-up message names My Account > Security;
- the support entry and `docs/ERROR_CODES.md` name My Account → Security and Settings → Authentication → MFA Policy.

**Test:** `tests/test_mfa_grace_notice_destination.py`, whose three cases failed before the fix.
**Not re-driven:** a fresh notice needs a member newly granted a privileged position, so it rests on the test. Notices already delivered keep their old text.

### W07-3 — LOW — The treasurer's department cards sit on Personal, the admin's under My Department — FLAGGED

**Saw:** `treasurer` has no My Department tab. The department pulse, Dues, Cash flow, Budget threshold and the grant cards all show on Personal, above the treasurer's own cards. For `admin` the same cards are under My Department, and Personal holds only the personal cards.
**Where:** `Dashboard.tsx` shows the My Department tab only for `settings.manage`, chief-level operations and the asset-manage grants. The money and grant cards come from the widget list (`get_main_dashboard_widgets`), gated on `finance.manage` and `fundraising.view`. With no tab to hold them, they render on Personal.
**Why not fixed:** the 2026-11-05 redesign's rule is "everyone lands on Personal; department-wide reporting waits for the tab". Should a finance holder get the tab, or should the money cards stay on a treasurer's Personal view because that is their daily work? That's a product call.

### W07-4 — NIT — Two thin My Department tabs

`membership_coordinator`'s tab holds one card (Membership health: Active members 20). `quartermaster`'s holds Assets & operations, which reads all-clear on a fresh install. Both are correct for the role, but a tab with one card is a question for the redesign, not a defect.

### Checklist

| Section                 | Result                                                                   |
| ----------------------- | ------------------------------------------------------------------------ |
| 1. The job gets done    | ✅ every role's dashboard loads, both tabs                               |
| 2. The right people     | ✅ My Department and its sections gated per role; W07-3 flagged          |
| 3. Wrong input, failure | ✅ no broken values on any tab                                           |
| 4. Browser signals      | ✅ no failed request or console error across ten roles                   |
| 5. Coming back to it    | ✅ every link opens a page the role can use                              |
| 6. On a phone           | ✅ no overflow, nothing under 44px, nothing unnamed                      |
| 7. Everyone can use it  | ✅ the tabs are a named tablist, and the cards' buttons carry their text |
| 8. What happens around  | ✅ a switched-off module is never asked (W01 lead resolved); W07-2 fixed |

### Completion gate

| Check                  | Result                                                                                                                           |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| flake8 / black / isort | ✅ `dependencies.py`, `auth.py`, `error_codes.py`, `tests/test_mfa_grace_notice_destination.py`                                  |
| backend tests          | ✅ 103 passed: the new test and the MFA policy, MFA endpoint, error-code and step-up suites; the new cases failed before the fix |
| npm run typecheck      | ✅ clean, no frontend change                                                                                                     |
| docs                   | ✅ `check_docs_links.py`: 0 broken links                                                                                         |
