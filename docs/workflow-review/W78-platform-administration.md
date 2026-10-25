# Workflow Review — W78 Platform Administration

**Driven:** 2026-10-22 (Chicago evening; 2026-10-23 UTC) · **As:** `admin`, `member` · **Viewports:** 1280×900, 390×844
**Commit:** `origin/main` of 2026-10-22 plus this run's changes · **Database:** continued from W77

---

## What was driven

1. As `admin`, Platform Analytics (`/admin/platform-analytics`):
   - every section, and the same numbers through `GET /platform-analytics`;
   - Export;
   - one client error logged through `POST /errors/log` (`W78_PROBE`), and
     the page read again;
   - Elections switched off under the organization's modules, the page read,
     and Elections switched back on.
2. As `member`: the page and `GET /platform-analytics`.
3. At 390×844, as `admin`: the whole page.

Not driven: the Refresh button (the reload covers the same request), and
module usage with a module that has records but is switched off.

## Held up ✅

- **Access:** `member` gets Access Denied on the page and 403 from the API.
- **Totals:**
  - users (20), active (10) and the adoption rate (50%) agree with the
    accounts' `last_login_at`;
  - the module record counts and last-activity dates match the data;
  - the top error types include the probe.
- **Export:** downloads `platform-analytics-2026-10-22.json`, named for the
  Chicago date at 8 PM, with the same numbers.
- **At 390×844:** no sideways scroll; the charts scroll within themselves.

## Findings

### W78-1 — MED — The trends ended yesterday, by the UTC calendar — ✅ FIXED

**Did:** logged one client error, then read the page.
**Saw:** "Errors, last 7 days" went from 10 to 11, but the trend under it
still added up to 10. The new error was missing because the trend stopped
before today.
**Where:** `platform_analytics.py` grouped both trends by
`cast(created_at, Date)`, the UTC date, and laid out N days starting
`now - N days`, so the last bar was the previous UTC day. Everything
since UTC midnight was in the headline and not in the chart. A Chicago
evening also landed on the next day, and the login trend had the same
gap.
**Fix:** `_local_daily_counts` groups by UTC date and hour in SQL and moves
each bucket to the organization's local date (`resolve_reporting_timezone`).
The trends are whole local days ending today. Errors (7 days) and Active
Users (30 days) now count the same window as the chart under them.
Re-driven: the last bar is 22 October, Chicago time, which holds the probe,
and each chart sums to its total.
`tests/test_platform_analytics_w78.py::TestTrends` (fails without the fix).

### W78-2 — LOW — Every module was badged "Enabled" — ✅ FIXED

**Did:** switched Elections off, then opened the page.
**Saw:** "Elections · Enabled". The endpoint passed a literal `True` for
every module (CLAUDE.md pitfall 19, in reverse: the screen reported a state
it never read).
**Fix:** `enabled` is read from the organization's enabled modules through
`OrganizationService.get_enabled_modules`, the same source navigation uses.
Meetings maps to the `minutes` module. Re-driven: "Elections · Disabled", and
"Enabled" once it was switched back on.
`TestModuleSwitches` (fails without the fix).

### W78-3 — MED — Both charts drew no bars at all — ✅ FIXED

**Saw:** the login and error charts showed day numbers and nothing above
them. Every non-zero bar measured 0px tall.
**Where:** `PlatformAnalyticsPage.tsx` `BarChart`: the bar's height is a
percentage, and its column was sized by its content, so the percentage had
nothing to resolve against.
**Fix:**

- The column fills the chart row, and the bar sits in a `flex-1` track.
  Re-driven: bars are 23–93px tall in proportion.
- The count is printed over each bar. It was only in a `title` tooltip,
  which a phone or a screen reader cannot reach.
- The chart is a named image whose label reads out the busy days ("Errors
  per day: Oct 16 4, Oct 21 2, Oct 22 4").
- The login chart's heading is now "Latest Sign-In by Day (30 Days)". It
  counts each member once, on the day of their most recent sign-in; there is
  no per-sign-in history, so "Daily Login Activity" overstated it.

`src/pages/PlatformAnalyticsPage.w78.test.tsx`.

## Checklist

| Section                 | Result                                                                     |
| ----------------------- | -------------------------------------------------------------------------- |
| 1. The job gets done    | ❌ → ✅ both charts were empty; fixed                                      |
| 2. The right people     | ✅ member refused on the page and the API                                  |
| 3. Wrong input, failure | ✅ each section fails on its own (read from code); nothing failed here     |
| 4. Browser signals      | ✅ clean                                                                   |
| 5. Coming back to it    | ✅ numbers re-read after a reload and through the API                      |
| 6. On a phone           | ✅ no sideways scroll; bars legible                                        |
| 7. Everyone can use it  | ❌ → ✅ chart counts were tooltip-only; now printed and named              |
| 8. What happens around  | ❌ → ✅ trends disagreed with their totals; module badges ignored switches |

## Completion gate

| Check                    | Result                                                                                                         |
| ------------------------ | -------------------------------------------------------------------------------------------------------------- |
| npm run typecheck        | ✅ clean                                                                                                       |
| npm run lint             | ✅ clean, with `NODE_OPTIONS=--max-old-space-size=8192` (see the W77 tooling lead)                             |
| flake8 (changed files)   | ✅ clean                                                                                                       |
| black --check            | ✅ clean                                                                                                       |
| frontend tests (touched) | ✅ `src/pages/PlatformAnalyticsPage*` 2 passed; both fail without the fix                                      |
| backend tests (touched)  | ✅ `test_platform_analytics_w78.py` and `test_module_api_gating.py`: 26 passed; the new 2 fail without the fix |
