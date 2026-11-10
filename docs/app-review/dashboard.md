# Application Review — Dashboard & Action Items

**Prefix:** `DASH` · **Iteration:** A7 · **Reviewed:** 2026-08-05 (pass 1),
2026-08-08 (pass 2), 2026-10-04 (pass 3), 2026-11-10 (pass 4)

## Pass 4 (2026-11-10) — the pulse layout and the paged action-item feed

Scope: the delta since pass 3 (`f9211ea3`, 2026-10-04) — 762 changed lines in
`dashboard.py`, the new `schemas/dashboard_pulse.py`, and the two services —
plus the open list. `dashboard.py` now has **13 routes** (was 7): five
`/pulse-layout` routes and `/action-items/page` are new. **2 fixes, 0 newly
flagged; DASH-37, 38 and 39 verified resolved; DASH-2 still open and now
recorded in KNOWN_LIMITATIONS.**

### DASH-41 — LOW — The department-default audit rows recorded no origin — ✅ FIXED

`set_department_pulse_layout` and `reset_department_pulse_layout`
(`dashboard.py:1126`, `:1155`) write an `organization_settings_updated` row
naming who changed a setting every member's dashboard reads, but left
`ip_address` and `user_agent` empty — the gap W02-12 closed for the member
endpoints. Both handlers now take the request (keyword-only in effect, no
change to the HTTP API) and pass `get_client_ip(request)` and the user agent.
`TestDepartmentDefaultAuditRows` in `test_dashboard_pulse_layout.py` failed
before the fix, and with the two arguments removed again it fails on
`[(None, None), (None, None)]`.

The same gap in `organizations.py`'s own settings rows is not this feature's
code and is left to the organizations pass; the attendance-waiver row in
`meetings.py:596` is left to B6.

### DASH-42 — LOW — "Save as department default" was hidden from a holder the server accepts — ✅ FIXED

The two `/pulse-layout/default` routes accept `settings.manage` **or**
`organization.update_settings`; `DashboardOrganizationWidgets` offered the save
and reset buttons on `settings.manage` alone. No seeded position holds one
without the other (`fire_chief` and `president` hold both), so only a custom
role saw the difference — a member allowed to set the default who was never
shown the control. The gate now checks the same pair, as `ReviewRulesTab` and
the three finance settings cards already do. A new Vitest case
(`offers the department default to someone holding only
organization.update_settings`) failed before the change. The existing
negative case is renamed, not changed: its assertion — no settings permission,
no button — still holds.

### Re-verified

- **DASH-37 — resolved** (`7f0ef2c1d`, `253b9e330`). All 22 server-supplied
  tile targets were enumerated from `dashboard.py`, and every query parameter
  is read by its page (`stock`, `status`, `serviceStatus`, `hasDeficiency`,
  `inspection`, `maintenance`, `dueWithin`, `compliance`, `source`, `range`,
  `page`/`tab`). Spot-checked that tile and list count the same rows where no
  shared helper ties them: the inspections and compliance tiles match
  `page_inspections`/`list_compliance_checklists`' `due_within_days`
  conditions, both on `resolve_org_today`; the events tile's 30 department
  days match `EventsPage`'s `nextThirtyDaysWindow`, and both exclude cancelled
  events.
- **DASH-38, DASH-39 — resolved** by the owner's 2026-11-01 decisions (batch
  6): `?maintenance=due` on the fleet board, and a genuine
  `maintenance_due_soon_conditions` facility figure with a matching `due`
  list filter.
- **DASH-40 — resolved 2026-11-05**, as recorded above.
- **DASH-2 — still open.** `GET /dashboard/stats` still returns
  `total_documents=0`, `setup_percentage=100` and `pending_tasks_count=0`, and
  `dashboardService.getStats` still has no caller. Four passes flagged it and
  none mirrored it into KNOWN_LIMITATIONS, so it missed the owner's 2026-11-01
  round; it is recorded there now.

### Verified good ✅

- **All 13 routes authenticated** (an AST check of each handler's
  dependencies): the per-member routes use `get_current_active_user` and gate
  per section or are self-scoped; `/pulse-layout/default` (both methods)
  requires `settings.manage` or `organization.update_settings`,
  `/admin-summary` `settings.manage`, `/community-engagement` `events.manage`.
- **The pulse layout is preference only and bounded.** The personal routes
  take no id and write only the caller's row; the card list is a closed set of
  eight with duplicates refused, titles are length- and control-character
  checked, unknown keys forbidden; stored JSON is read through
  `normalize_pulse_layout`, which degrades a bad value to "not set" rather
  than failing the page (pitfall #19). A fresh dict is written each time
  (pitfall #12), and `update_organization_settings` deep-copies.
- **The paged feed returns the rows a full merge would.** Each half is read in
  the merge key's order, `(due IS NULL, day, created_at, id)`, only as far as
  `offset + limit`; `heapq.merge` is stable, so the slice matches. Totals are
  counted under the same conditions as the rows, and the meeting-label lookups
  are confined to the caller's organization.
- **One definition of open and overdue per source**
  (`meeting_action_item_open`, `minutes_action_item_overdue`, …) is now shared
  by the operations tiles, the admin summary and the feed, and minutes items
  are overdue by the department's calendar day.
- **A `status_filter` outside an enum matches nothing rather than erroring**:
  SQLAlchemy's `Enum` passes an unknown string through when
  `validate_strings` is off, so a stray value is an empty list, not a 500.

### Leads for other passes

- **B6 meetings:** `grant_attendance_waiver`'s audit row (`meetings.py:596`)
  records no IP or browser.
- **B18 training:** the training-officer dashboard's cards
  (`components/dashboard/widgets/training/index.tsx:19`) are plain `<a href>`,
  a full page load inside the SPA, and the member-status card builds its year
  from the browser clock (`new Date().getFullYear()`), not the department's.

### Pass 4 completion gate

| Check                                           | Result                                                                                                 |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `npm run typecheck`                             | ✅ 0 errors                                                                                            |
| `npm run lint`                                  | ✅ exit 0                                                                                              |
| `python -m flake8 app/ tests/`                  | ✅ 0 violations                                                                                        |
| `black --check app/ tests/`                     | ✅ 2330 files unchanged                                                                                |
| `isort --check-only` (changed files)            | ✅ clean                                                                                               |
| `vitest DashboardOrganizationWidgets`           | ✅ 16 passed (1 added)                                                                                 |
| `pytest -k "dashboard or action_item or pulse"` | ✅ 202 passed, 1 skipped (`py_vapid` not installed), 1 setup error — see below; its file then 8 passed |

The first backend run errored one test at setup,
`test_medical_screening_read_audit.py::test_own_dashboard_counts_are_not_logged`,
on `Data too long for column 'requirement_id'`. That was this sandbox's
database, built at session start from an older branch and so behind MS-18's
widening of the column (`alembic current` read `8b2d4f6a1c3e`, head
`67ad01c43434`). After `alembic upgrade head` and `repair_schema.py`, the
file's 8 tests pass; no code was involved.

---

## Pass 3 (2026-10-04) — the three endpoints pass 2 never saw

`dashboard.py` is **1452 lines and 7 routes**; pass 2 reviewed 456 lines and 4.
`GET /asset-widgets`, `GET /operations` and `GET /widgets` all arrived after it,
which is where this pass concentrated. **7 fixes, 4 flagged.**

The authorization lens came back clean, including the one lead worth chasing:
`minutes_visibility_filter` is applied at exactly one of the four places this
file reads `ActionItem`, which looks like the DASH-1 defect returning. It is
not. The filter returns `None` — no restriction — precisely for
`minutes.manage` holders, and the new `/operations` read is gated on
`minutes.manage`, so applying it there would be a no-op by construction. The
other two are the counts-only case pass 2 accepted behind `settings.manage`.
Likewise the meeting half of `/action-items`: `MeetingStatus` has a `DRAFT`
state, so it looked like minutes' executive/draft restriction should apply —
but `MeetingsService.get_open_action_items` filters org and status only, so the
dashboard mirrors its owning module exactly, which is what DASH-3 asked for.

What this pass found instead is a whole dimension nothing was checking: **the
dashboard's links.** Five server-supplied navigation targets pointed at paths
no route declares, and `App.tsx`'s catch-all turned every click into a silent
redirect to the dashboard. The tiles looked fine and did nothing.

### DASH-30 — MED — Five dashboard links went nowhere — ✅ FIXED

`App.tsx:204` declares `<Route path="*" element={<Navigate to="/" replace />} />`,
so a target matching no route does not 404 — it bounces the user back to the
dashboard they clicked from, which is indistinguishable from a dead button.
Five of them:

| Where                                        | Pointed at                            | Reality                                           |
| -------------------------------------------- | ------------------------------------- | ------------------------------------------------- |
| `asset-widgets` inventory-expiring-lots      | `/inventory/lots?expiresWithin=30`    | never a route; API path only                      |
| `asset-widgets` inventory-equipment-requests | `/inventory/requests?status=pending`  | API path; the page is `/inventory/admin/requests` |
| `asset-widgets` apparatus-maintenance        | `/apparatus/maintenance?dueWithin=30` | API path; no maintenance route exists at all      |
| `operations` notification_failures           | `/notifications/manage?status=failed` | the module declares `/notifications` only         |
| `operations` training_records                | `/training/reports`                   | never existed                                     |

**Fix:** retargeted to the real destinations —
`/inventory/admin/checklists/supply` (the expiring-supply page, which already
defaults to a 30-day horizon matching the count's window),
`/inventory/admin/requests`, `/notifications?status=failed`, and
`/training/admin?page=dashboard&tab=overview` (the same target
`/training/officer` redirects to). `apparatus-maintenance` has no destination
to point at, so it goes to the fleet board, which surfaces the same
due/overdue tallies in its summary strip; a dedicated view is DASH-38.

**Why two review passes missed this.** `routeIntegrity.test.ts` has done
exactly this check since the Add Member button broke — it walks the source for
`to=`/`href:`/`navigate()` targets and matches them against declared `path=`
strings. It scans `frontend/src/**/*.tsx?` only, and these five hrefs are
**Python string literals** served as response data. No frontend scan could
ever have seen them.

**Fix for the class, not the instances:** the test now also walks a named list
of backend modules that build navigation targets as response data
(`dashboard.py`, `admin_hub_service.py` — 40 targets between them), matching
`href="/…"` with a literal leading slash, which excludes the HTML-email
anchors elsewhere in `app/services/` whose targets are interpolated absolute
URLs. It found the two `/operations` links above on its first run, which I had
not spotted by reading. A missing file in that list throws rather than
quietly halving the scan, and a floor assertion per source file guards against
a regex that stops matching. Mutation-verified: restoring
`/inventory/requests?status=pending` fails the check, naming the file and line.
`admin_hub_service.py`'s 19 hrefs were all already valid.

### DASH-31 — MED — A facilities tile reported its neighbour's number — ✅ FIXED

`facilities-urgent-work-orders` and `facilities-maintenance` both rendered the
single `maintenance` count — one `due_date <= today` query, i.e. overdue — so a
department with three overdue work orders read **"Urgent work orders: 3"**
beside **"Maintenance due: 3"** with nothing to say they were the same three.
The duplicate was a copy of its neighbour in every respect that mattered and
wrong in all three it changed: the title said "due" where the query said
overdue, the empty state said "overdue" where the title said due, and the
`href` was `?status=due` — a value `MaintenanceListPage` does not accept (its
filter is `all | pending | completed | overdue`), so it filtered nothing.

The sibling modules do this correctly: `apparatus-maintenance` has its own
`maintenance_due_soon` figure, distinct from `apparatus-overdue-checks`.

**Fix:** removed the duplicate tile. Reporting genuine
upcoming-but-not-yet-overdue facility maintenance needs a second query **and**
a `due` filter on that page; both are flagged (DASH-39) rather than invented
here. Locked by a test asserting no two facilities tiles carry the same count —
which catches a reinstated duplicate however it is titled, not just by id.

### DASH-32 — MED — Nine tiles whose only action was Access Denied — ✅ FIXED

The apparatus block carries a careful comment about this exact trap and a
`_may_open_apparatus` guard implementing it: authority for the tallies is
`apparatus.manage` or `settings.manage`, but every widget links into
`/apparatus`, which the route gates on `apparatus.view` OR `apparatus.manage`,
so a delegated `settings.manage` role holding neither is handed a tile that can
only answer Access Denied.

**The lesson landed on one of the three blocks.** Inventory and facilities
grant on `<module>.manage` OR `settings.manage` with no destination check:

| Block        | Granted on                               | Destination route needs                  | Gap              |
| ------------ | ---------------------------------------- | ---------------------------------------- | ---------------- |
| `inventory`  | `inventory.manage` or `settings.manage`  | `inventory.manage` (all 5 destinations)  | **5 dead tiles** |
| `apparatus`  | + `_may_open_apparatus`                  | `apparatus.view` or `apparatus.manage`   | none             |
| `facilities` | `facilities.manage` or `settings.manage` | `facilities.view` or `facilities.manage` | **4 dead tiles** |

**Fix:** the same guard on both blocks. Behaviour-preserving for anyone holding
the module's own grant; it removes tiles only for a delegated settings role that
could not open them anyway. For inventory the destination gate is the stricter
of the two and subsumes the `settings.manage` arm, so that block reads as a
single condition rather than the two its siblings need — keeping the redundant
`or` for symmetry would have been a clause that cannot change the outcome, so
the comment carries the reasoning and names what has to come back if
`/inventory*` ever widens. The alternative direction — widening `/inventory*` and `/facilities*` to
accept `settings.manage` — is a permissions-model change in those modules, not
a dashboard correction, and the apparatus precedent in this same file already
chose this one.

The existing apparatus test is now parametrized across all three modules, and
its comment claiming `settings.manage` "legitimately opens the inventory and
facilities blocks" is corrected — the fix makes that false.
Mutation-verified: removing either new guard fails the matching case.

### DASH-33 — MED — The wiki documented the opposite of the code — ✅ FIXED

`wiki/API-Reference.md` described `/dashboard/asset-widgets` as gated on
"`inventory.view`, `apparatus.view` and `facilities.view` respectively —
**permission-only; there is no module check here.**" Both halves are wrong, and
wrong in the lax direction:

- The code requires each module's **manage** grant or `settings.manage`. The
  endpoint's own comments explain at length why `*.view` is deliberately **not**
  sufficient (these are management-reporting tallies, and two of the three view
  grants were baseline member grants when the gates were written).
- Every block checks `"<module>" in enabled`. The docstring explains why. The
  summary table two sections earlier repeated the error ("Module-gated? No —
  permission-only"), as did the prose claiming only `/operations` combines both.

An integrator reading this would have expected a `*.view` holder to receive
widgets. Corrected, with a per-block table and a note that the second condition
on each row is a destination check rather than a second data gate.

### DASH-34 — LOW — The 30-day event window drifted across DST — ✅ FIXED

`/operations` built its upcoming-events boundary as
`local_midnight + timedelta(days=30)`. `local_midnight` is already a UTC
instant, so the sum lands on 23:00 or 01:00 **local** whenever a DST transition
falls inside the window, moving an event in that hour into or out of the next
reporting period. Same class as CC-5 (A5). Fixed by shifting the local date and
re-resolving midnight, exactly as `local_midnight` itself is built.

The test freezes the clock on purpose: with the real one the assertion would
hold most of the year under the arithmetic it is meant to reject, so a fixed
2026-10-04 puts the US DST end inside the 30 days and makes the check mean the
same thing in June as in October. Mutation-verified.

### DASH-35 — LOW — Community engagement measured two different populations — ✅ FIXED

`total_public_events` excludes cancelled events. The two attendee tallies beside
it did not, so a department that cancelled a fundraiser after check-in read
attendees it had no event to attribute them to — and the comment above the
external-attendee query claimed the two attendee figures "describe the same
event population", which was true of each other and not of the event count they
sit next to. Added `is_cancelled` to both subqueries. Mutation-verified.

### DASH-36 — LOW — Stale permission name and a map entry that controls nothing — ✅ FIXED

`OPERATIONS_SECTION_PERMISSIONS["critical_exceptions"]` is the one entry of six
`_has_any` is never called with: that section is assembled item by item, each
behind the permission owning its data source, then emitted only if any item
survived. That is strictly finer than the union, so the union is documentation,
not control — now said so in a comment, and the wiki now states that holding
`notifications.manage` alone returns the section with the notification item
only.

The wiki also published `equipment_check.manage` for that section, which is a
`LEGACY_PERMISSION_ALIASES` entry — it still resolves, but the real name has
been `inventory.check_manage` since the module segment changed. Corrected.
`docs/CHANGE_AUDIT_2026-08.md` carries the same old name and was left
alone: it is a dated record of what was true then.

## Pass 3 flagged

### DASH-37 — MED — "View filtered results" is unimplemented for 13 of 16 links — 🚩 FLAGGED

Every asset-widget tile renders `aria-label="{title}: {count}. Open filtered
results"` and a body line reading "View filtered results". Of the 16
server-supplied targets carrying a query string, **3 are honoured**:

- `/facilities/maintenance?status=overdue` → `MaintenanceListPage` reads `status`
- `/inventory/checklists/log?status=…&submitted=1` → `CheckLogPage` reads both
- `/training/admin?page=…&tab=…` → the canonical hub target

The other 13 land on a page that ignores the parameter, so the user arrives at
an unfiltered list and has to re-find the rows the tile just counted:
`ApparatusListPage`, `InspectionsListPage`, `FacilitiesDashboard`,
`InventoryCheckoutsPage`, `ActionItemsPage`, `EventsPage`, `Members` and
`AdminHoursManagePage` call `useSearchParams` not at all; `InventoryItemsPage`
reads `vendor_id` and `item_type` but not `stock`; `NotificationsPage` reads
`tab` but not `status`.

Telling: the two honoured ones are exactly the two whose hrefs carry an
explanatory comment in `dashboard.py` — someone did the work for those and the
rest were written as if the pages already filtered.

**Not fixed** because it is page work across eight components, each needing a
decision about which filters are addressable, and the announcement
("Open filtered results") is also wrong on an informational tile like
`inventory-summary` where there is nothing to filter. Worth its own iteration.
The check in DASH-30 proves a path exists; proving a _parameter_ is read needs
route-to-component resolution, which is the harder half and not attempted here.

### DASH-38 — LOW — No apparatus maintenance view exists — 🚩 FLAGGED

`apparatus-maintenance` counts `maintenance_due_soon` and now points at the
fleet board for want of anywhere better. `/apparatus/maintenance` is an API
path with a full CRUD surface (`apparatus/maintenance`,
`apparatus/maintenance/due`, `apparatus/maintenance-types`) and no page. Either
build the page or fold the figure into the fleet board explicitly.

### DASH-39 — LOW — No genuine upcoming-facility-maintenance figure — 🚩 FLAGGED

Follow-up to DASH-31. Needs a `due_date > today AND <= today+30` query **and** a
`due` value accepted by `MaintenanceListPage`'s filter. The apparatus block is
the model.

### DASH-40 — LOW — `/action-items` is unpaginated — 🚩 FLAGGED

The feed returns every matching action item in the organization from both
sources, sorted in Python, with no `limit`/`offset` and no cap. Fine for a
department with dozens; a department with years of minutes gets the lot on
every dashboard load. `ActionItemSummary` carries free-text `description`, so
the payload grows with the content, not just the row count.

**✅ Resolved 2026-11-05 (owner decision 2026-11-01: page or cap).** The list
route is capped at 200, and `/dashboard/action-items/page` pages it, cut from
the merged order, with totals over every match. See KNOWN_LIMITATIONS.md,
DASH-40.

### DASH-2 — LOW — re-verified, still open — 🚩 FLAGGED

`GET /dashboard/stats` still returns `total_documents=0`,
`setup_percentage=100`, `pending_tasks_count=0`, and `dashboardService.getStats`
still has zero callers (re-checked across `frontend/src`). Unchanged since pass
2: delete-or-implement, and both are decisions. `setup_percentage=100` asserting
completeness remains the specific risk.

### Note — not a dashboard finding — meetings does not restrict drafts

`MinutesStatus` restricts draft and executive-session minutes (MM-3);
`MeetingStatus` has `DRAFT` and `PENDING_APPROVAL` and
`MeetingsService.get_open_action_items` restricts neither, so any
`meetings.view`/`minutes.view` holder reads action items from unapproved
meetings — through the meetings module's own endpoint as much as through the
dashboard. Whether that asymmetry is intended belongs to the Meetings/Minutes
iteration (B6), not here; recorded so it is not rediscovered as a dashboard bug.
The dashboard is correct either way: it mirrors its owning module exactly, which
is what DASH-3 required.

## Pass 3 verified good ✅

- **All 7 routes authenticated.** `/admin-summary` requires `settings.manage`,
  `/community-engagement` requires `events.manage`; the other five use
  `get_current_active_user` and gate in-code per section, which is the right
  shape for a multi-section widget endpoint and the same remediation DASH-3
  used.
- **Every aggregate is org-scoped**, including the three new endpoints and the
  `ActionItem` reads that need the `MeetingMinutes` join to get there.
- **`minutes_visibility_filter`'s single application site is correct** — see the
  preamble. The three unfiltered reads are each justified, and the two
  `/admin-summary` ones remain counts-only behind `settings.manage`.
- **`pending_approvals` correctly omits a module check.** It is the only
  `/operations` section without one, which looks like an oversight and is not:
  `ModuleSettings` has no `admin_hours` field, so there is no toggle to consult.
- **The `/operations` module+permission pairing is complete** across the other
  five sections, and `_count_and_oldest`/`_age_days` resolve ages on the
  department's calendar rather than the UTC date.
- **`/widgets` keeps `settings.manage` out of money**, as its docstring claims:
  finance needs `finance.manage`, fundraising `fundraising.view`, outreach
  `events.manage`, each also behind its module flag.

## Pass 3 completion gate

| Check                       | Result                                                    |
| --------------------------- | --------------------------------------------------------- |
| `npm run typecheck`         | ✅ 0 errors                                               |
| `flake8 app/ tests/`        | ✅ 0 violations                                           |
| `black --check app/ tests/` | ✅ 1351 files unchanged                                   |
| `eslint` (changed file)     | ✅ clean                                                  |
| `vitest routeIntegrity`     | ✅ 7 passed (was 5; 2 added)                              |
| backend dashboard suite     | ✅ 97 passed, 1 skipped (`-k "dashboard or action_item"`) |

Every fix above was mutation-verified: the fix was reverted, the new test was
confirmed to fail and to name the right file and line, and the revert was undone
with the same mechanism that applied it.

---

## Pass 2 (2026-08-08) — six-lens sweep

Re-verified pass-1: `minutes_visibility_filter` mirrors `MinuteService`'s
`restricted` branch and is applied to the minutes half; every aggregate filters
`organization_id` (RPT-1 clean); the dashboard is read-only (no cross-org write).
But the XC-2 lens found the DASH-1 fix closed only the _inner_ split. **1 fix.**

### DASH-3 — HIGH — `/dashboard/action-items` had no permission gate (XC-2 re-exposure) — ✅ FIXED

`get_unified_action_items` depends only on `get_current_active_user` — **no
permission**. The **meeting half** filtered only `organization_id`, so **any**
authenticated member (e.g. a probationary member with neither `meetings.view` nor
`minutes.view`) could read **every meeting action item's `description`** org-wide;
the minutes half applied `minutes_visibility_filter` but that only reproduces the
_inner_ manage/non-manage restricted split (it presupposes the caller already holds
`minutes.view`) — it did **not** reproduce the _outer_ view gate the sibling modules
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
  _(Note for future iterations: an AST scan looking only for `require_permission`
  or `get_current_user` reports these first two as ungated —
  `get_current_active_user` is a third spelling. Worth widening the detector
  rather than trusting a narrow one.)_
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
item is free text from that record: _"Follow up with counsel re: the Smith
termination hearing"_ is a realistic value. The restriction MM-3 added to the
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
asserts against the compiled SQL — the predicate _is_ the control, and it can be
verified without MySQL.

### DASH-2 — LOW — `GET /dashboard/stats` is unused and half-stubbed — 🚩 FLAGGED

**What:** three of the six fields the endpoint returns are hardcoded:

```python
total_documents=0,
setup_percentage=100,
pending_tasks_count=0,
```

**Impact:** _nothing today_ — `dashboardService.getStats` has **zero callers**
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

| Check                | Result                                                                                                                                      |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `tsc --noEmit`       | ✅ 0 errors (no frontend change)                                                                                                            |
| `flake8 app/ tests/` | ✅ 0 violations                                                                                                                             |
| `black --check`      | ✅ 503 files unchanged                                                                                                                      |
| `eslint`             | ✅ clean                                                                                                                                    |
| backend tests        | ✅ **2512 passed, 0 failed** (was 2508 — 4 tests added). 648 errors, all `db_session` fixture failures against the sandbox's missing MySQL. |

</content>
