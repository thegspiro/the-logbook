# Application Review — Dashboard & Action Items

**Prefix:** `DASH` · **Iteration:** A7 · **Reviewed:** 2026-08-05 (pass 1),
2026-08-08 (pass 2)

## Pass 2 (2026-08-08) — six-lens sweep

Re-verified pass-1: `minutes_visibility_filter` mirrors `MinuteService`'s
`restricted` branch and is applied to the minutes half; every aggregate filters
`organization_id` (RPT-1 clean); the dashboard is read-only (no cross-org write).
But the XC-2 lens found the DASH-1 fix closed only the *inner* split. **1 fix.**

### DASH-3 — HIGH — `/dashboard/action-items` had no permission gate (XC-2 re-exposure) — ✅ FIXED

`get_unified_action_items` depends only on `get_current_active_user` — **no
permission**. The **meeting half** filtered only `organization_id`, so **any**
authenticated member (e.g. a probationary member with neither `meetings.view` nor
`minutes.view`) could read **every meeting action item's `description`** org-wide;
the minutes half applied `minutes_visibility_filter` but that only reproduces the
*inner* manage/non-manage restricted split (it presupposes the caller already holds
`minutes.view`) — it did **not** reproduce the *outer* view gate the sibling modules
enforce (`meetings.py` requires `meetings.view` OR `minutes.view`; `minutes.py`
requires `minutes.view`). The frontend `/action-items` route has no `ProtectedRoute`
either, so the endpoint was the only gate. Action-item descriptions carry the
underlying meeting/minutes free text — including executive-session disciplinary and
legal matters. **Fix:** gate each half in-code (using the already-imported
`user_has_permission`) exactly as its owning module does — the meeting half behind
`meetings.view` OR `minutes.view`, the minutes half behind `minutes.view` —
independently, so a caller holding only one still sees only that half. No new
permission, no frontend change. 3 DB-free regression tests (no-perm → nothing
queried; `meetings.view` → meeting half only; `minutes.view` → both).

**Flagged (LOW, unchanged/new):** DASH-2 (`/dashboard/stats` hardcoded, zero frontend
callers — delete-or-implement); the `admin-summary` open/overdue **counts** fold in
restricted-minutes items with no visibility filter (behind `settings.manage`, exposes
only integers — no free text, so not the DASH-1 vector); the meeting-half
`assignee_name` is unpopulated and its `priority` is emitted as a raw int string
(display nits).

---

**Backend:** `app/api/v1/endpoints/dashboard.py` (456 L, 4 endpoints),
`app/services/attendance_dashboard_service.py` (329 L, reached via
`endpoints/meetings.py`)
**Frontend:** `pages/Dashboard.tsx`, `pages/ActionItemsPage.tsx`,
`modules/action-items`, `services/adminServices.ts`
**Docs:** none specific

---

## Scope

All 4 dashboard endpoints read in full, including every aggregate query, plus
the frontend service layer and caller graph. `attendance_dashboard_service` was
checked for gating and org scoping only — it is reached through
`meetings.py` and its business logic belongs to **B6**.

A dashboard is a cross-module aggregator, which makes it the natural home for
two specific failure modes: an aggregate that forgets its org filter (RPT-1),
and an aggregate that re-exposes data a sibling module deliberately restricted
(XC-2). The first is clean here. The second was not.

## Verified good ✅

- **All 4 endpoints authenticated.** `/stats` and `/action-items` use
  `get_current_active_user`; `/admin-summary` requires `settings.manage`;
  `/community-engagement` requires `events.manage`.
  *(Note for future iterations: an AST scan looking only for `require_permission`
  or `get_current_user` reports these first two as ungated —
  `get_current_active_user` is a third spelling. Worth widening the detector
  rather than trusting a narrow one.)*
- **Every aggregate is org-scoped, including the hard one.** RPT-1's finding was
  that minutes action items have **no `organization_id` column**, so counting
  them requires joining `MeetingMinutes`. Both places this endpoint file touches
  them — the `/admin-summary` counts and the `/action-items` feed — do exactly
  that, with a comment saying so. The lesson took.
- **`/admin-summary` isolates each module's query in its own `try`**, with a
  logged warning, so a failure in the training or events aggregate still returns
  member counts rather than 500-ing the whole dashboard. That is the right
  trade-off for a dashboard and is documented in the docstring.
- **`attendance_dashboard_service`** is reached only through a
  `meetings.manage`-gated route that passes `current_user.organization_id`.

## Findings

### DASH-1 — MED — Unified action-item feed re-exposed restricted minutes — ✅ FIXED

**What:** `GET /dashboard/action-items` merges action items from the Meetings
and Minutes modules. The minutes half joined `MeetingMinutes` and filtered on
`organization_id` **only** — no status or meeting-type restriction — and the
endpoint requires **no permission at all** (`get_current_active_user`).

**Where:** `dashboard.py` `get_unified_action_items`.

**Impact:** MM-3 established that draft and executive-session minutes are
restricted to `minutes.manage` holders, and fixed the minutes module's own four
read paths so a restricted caller "sees only approved, non-executive minutes (by-id
404s on restricted records)". `MinuteService.get_minutes` still enforces that via
its `restricted` flag.

This endpoint bypassed it. Any authenticated member — any probationary
firefighter — could read the `description`, `assignee_name`, `due_date` and
`priority` of action items belonging to **unapproved drafts and closed
executive-session minutes**. In a fire department, executive session is where
personnel discipline, terminations and legal matters are handled, and an action
item is free text from that record: *"Follow up with counsel re: the Smith
termination hearing"* is a realistic value. The restriction MM-3 added to the
front door was intact; this was a side door into the same content.

Same XC-2 shape as MM-3 itself, reached through a sibling module — which is the
general lesson: **a restriction applied in the owning module has to be applied
at every cross-module read of the same rows.**

**Fix:** extracted `minutes_visibility_filter(current_user)` and applied it to
the feed. It returns `None` for a `minutes.manage` holder and otherwise confines
results to approved, non-executive minutes — mirroring `MinuteService`'s
`restricted` branch exactly, keyed on the same existing permission, so no new
permission or frontend change is needed.

**One judgment call worth confirming:** the filter carves out items **assigned to
the caller**, so a member still sees their own tasks even if they originated in
a draft or executive session. Without it, `assigned_to_me=true` would hide a
member's own work from them. If the owner would rather executive-session items
be invisible even to their assignee, delete the `ActionItem.assignee_id ==
current_user.id` branch — the tests name this behaviour explicitly, so the
change is one line and one test.

Locked by `tests/test_dashboard_action_item_visibility.py` (4 tests), which
asserts against the compiled SQL — the predicate *is* the control, and it can be
verified without MySQL.

### DASH-2 — LOW — `GET /dashboard/stats` is unused and half-stubbed — 🚩 FLAGGED

**What:** three of the six fields the endpoint returns are hardcoded:

```python
total_documents=0,
setup_percentage=100,
pending_tasks_count=0,
```

**Impact:** *nothing today* — `dashboardService.getStats` has **zero callers**
in the frontend (its two siblings, `getAdminSummary` and `getActionItems`, each
have one). So no user is currently shown a fabricated figure.

The risk is forward-looking and specific: `setup_percentage=100` does not report
"unknown", it asserts that setup is **complete**, always. A real
setup-completion source already exists (`GET /organization/setup-checklist`,
which derives from actual entity counts and is what `/setup` and the dashboard
progress card render). Someone wiring this endpoint up later would get a
confident, wrong answer rather than an obvious gap.

**Why not fixed:** the choice is delete-or-implement and both are decisions, not
corrections. Deleting risks removing an endpoint an integrator may call
(nothing here is documented as a public API, but nothing says it isn't);
implementing means picking the real sources for three separate metrics. Either
is a small, deliberate piece of work.

## Duplication

Minutes action items are queried in three places with the same
`join(MeetingMinutes).where(organization_id == …)` shape: the `/admin-summary`
counts, the `/action-items` feed, and the minutes module itself. That
repetition is what let DASH-1 diverge — the feed and the module disagreed about
visibility. `minutes_visibility_filter` now gives the endpoint file one place to
express the rule; a fuller fix would put it on the model or in a shared query
helper that every cross-module reader composes.

Noted rather than actioned: `/admin-summary`'s counts still include restricted
minutes, but it returns **counts only** (no descriptions) behind
`settings.manage`, so a number that includes an executive-session item is not a
disclosure of its content.

## Dead code

- `dashboardService.getStats` (frontend) and the `GET /dashboard/stats` endpoint
  it wraps have no consumer — see DASH-2.
- Nothing else unreferenced; no TODO/FIXME markers.

## Documentation gaps

None corrected. There is no doc page for the dashboard, which is defensible for
a read-only aggregate whose fields are self-describing — but the visibility rule
DASH-1 restored is exactly the kind of thing that should be written down
somewhere other than a code comment, because the next cross-module reader of
`ActionItem` will face the same choice.

## Future development

1. **Resolve `/dashboard/stats`** — delete it or wire the three stubbed fields
   to their real sources (DASH-2).
2. **Give the minutes-visibility rule one home.** It now exists in two places
   (`MinuteService.get_minutes`'s `restricted` flag and
   `minutes_visibility_filter`) that must be kept in agreement by hand. A shared
   query helper, or a documented rule on the model, would make the next
   cross-module read correct by default rather than by review.
3. **`/admin-summary` swallows per-module failures silently from the caller's
   point of view** — a failed aggregate logs a warning and returns `0`, which is
   indistinguishable from a real zero. Returning a per-section status would let
   the UI show "unavailable" instead of a confident wrong number. Same shape as
   the concern behind DASH-2.
4. **No dashboard tests existed before this iteration** beyond
   `test_attendance_dashboard_service.py`. The 4 added here cover the
   authorization predicate; the aggregates themselves remain untested.
5. **`assigned_to_me` on `/action-items` filters two different columns**
   (`MeetingActionItem.assigned_to` and `ActionItem.assignee_id`) whose naming
   divergence is a small trap for the next reader.

## Completion gate

| Check | Result |
|-------|--------|
| `tsc --noEmit` | ✅ 0 errors (no frontend change) |
| `flake8 app/ tests/` | ✅ 0 violations |
| `black --check` | ✅ 503 files unchanged |
| `eslint` | ✅ clean |
| backend tests | ✅ **2512 passed, 0 failed** (was 2508 — 4 tests added). 648 errors, all `db_session` fixture failures against the sandbox's missing MySQL. |
</content>
