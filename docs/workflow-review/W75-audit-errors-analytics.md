# Workflow Review — W75 Audit Log, Error Monitoring and Analytics

**Driven:** 2026-10-20 · **As:** `admin`, with `member2` for one deliberate failed sign-in · **Viewports:** 1280×900, 390×844
**Commit:** `origin/main` of 2026-10-20 plus this run's changes · **Database:** continued from W74

---

## What was driven

1. As `admin`, Audit Log (`/admin/audit-log`):
   - the totals and the severity tiles;
   - a search for `ip_exception`;
   - the event-type filter for `login_failed` and `integration.connected`;
   - the category filter, against the categories the stats endpoint lists;
   - a row's details, by mouse and by keyboard;
   - the same page at 390×844.
2. The W02-3 lead: one deliberate wrong-password sign-in for `review_member2`,
   then a sign-in and sign-out as `admin`, read back on the audit page.
3. As `admin`, Error Monitoring (`/admin/errors`):
   - the list of earlier errors, with page and action;
   - the error-type filter;
   - View details on a row;
   - Clear All, cancelled.
4. As `admin`, QR analytics: the overview and "Activity by Hour".

Not driven: analytics with real scans (none recorded on this database), and
Clear All confirmed (it would have erased the errors earlier runs left as
evidence).

## Held up ✅

- **Audit log:**
  - the totals and severity tiles agree with the list;
  - search for `ip_exception` returns the 8 W74 rows;
  - the event-type filter returns `login_failed` 1 and `integration.connected` 2.
- **W02-3 resolved:** the wrong password produced a `login_failed` row, and
  the admin's sign-in and sign-out produced `login` and `logout` rows.
- **W50-45 resolved:** "system" shows only for the row with no `user_id`
  (`finance.approval_step_approved`, approved through the email link); every
  other row names its actor. The runoff row from that lead no longer exists
  (the database was reset after W50), so that half was checked through the
  event-type filter on other types, which works.
- **Error monitoring:**
  - the earlier errors list their page and action;
  - Clear All asks first ("Clear all errors? … Keep them / Clear all").
- **Analytics:** the page renders 0 scans, which matches Department Overview.
- **At 390×844:** no sideways scroll; the audit cards open their details from
  a 44px button.

## Findings

### W75-1 — MED — The category filter offered only the ten busiest categories — ✅ FIXED

**Did:** opened the category filter.
**Saw:** 10 options, while the log held 18 categories. Integrations,
documents, minutes and the rest could not be selected, so an officer could not
filter to them at all.
**Where:** `audit_logs.py` `audit_log_stats` grouped `by_category` with
`.limit(10)`, and the page builds its filter from those keys.
**Fix:** the cap is removed; a department has a few dozen categories at most.
`tests/test_admin_monitoring_w75.py::test_stats_list_every_category` (fails
without the fix).

### W75-2 — LOW — "Activity by Hour" was charted by the UTC hour — ✅ FIXED

**Saw (read from code, confirmed by test):** a scan at 7:30 PM Chicago
charted at hour 0.
**Where:** `analytics.py` `get_metrics` grouped by `extract("hour",
created_at)` on the UTC timestamp.
**Fix:** the query groups by UTC date and hour, and each bucket is converted
to the organization's hour with `resolve_reporting_timezone`, so the chart
follows daylight saving correctly per day.
`test_activity_is_charted_by_the_local_hour` (00:30Z on 16 October charts at
19; fails without the fix).

### W75-3 — LOW — A desktop audit row could not be opened from the keyboard — ✅ FIXED

**Saw:** the row's details opened only on a click on the `<tr>`, which carried
`aria-expanded` but could not take focus.
**Fix:** the event name is a button with `aria-expanded` and `aria-controls`
naming the details row; the row click still works.
`src/pages/AuditLogPage.w75.test.tsx` (fails without the fix).

### W75-4 — LOW — Error Monitoring's controls were not usable by name — ✅ FIXED

- The error-type filter's label was not tied to its select.
- Every row's button read just "View details".

**Fix:** the label is tied with `htmlFor`; each button is named after its
error (its error type and the first part of its id, "View details of …" / "Hide details of …") and is 44px
on a touch screen. The existing test was updated to the new name.

## Checklist

| Section                 | Result                                                         |
| ----------------------- | -------------------------------------------------------------- |
| 1. The job gets done    | ❌ → ✅ category filter incomplete; fixed                      |
| 2. The right people     | ✅ admin-only pages, read from code and driven as admin        |
| 3. Wrong input, failure | ✅ Clear All asks before erasing                               |
| 4. Browser signals      | ✅ clean                                                       |
| 5. Coming back to it    | ✅ sign-in and sign-out events read back after a reload        |
| 6. On a phone           | ✅ no sideways scroll                                          |
| 7. Everyone can use it  | ❌ → ✅ keyboard row details, tied label, named detail buttons |
| 8. What happens around  | ❌ → ✅ hourly chart in the organization's time                |

## Completion gate

| Check                    | Result                                                                |
| ------------------------ | --------------------------------------------------------------------- |
| npm run typecheck        | ✅ clean                                                              |
| npm run lint             | ✅ clean                                                              |
| flake8 (changed files)   | ✅ clean                                                              |
| black --check            | ✅ clean                                                              |
| frontend tests (touched) | ✅ `src/pages/AuditLogPage*`, `src/pages/ErrorMonitoring*`: 19 passed |
| backend tests (touched)  | ✅ `-k "audit or analytics"` 396 passed, the new file's 2 among them  |
