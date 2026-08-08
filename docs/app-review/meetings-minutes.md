# Application Review — Meetings & Minutes (Tier B)

**Prefix:** `MM2` · **Iteration:** B6 · **Reviewed:** 2026-08-06 (pass 1),
2026-08-06 (pass 2)

---

## Pass 2 (2026-08-06)

Re-verified pass 1 (MM-4 FK validation, MM-3-frontend permission, DASH-1
consistency — intact). Then chased the module's distinctive risk — the
**executive-session read restriction** — across *every* path that reads minutes,
not just the four the restriction already covers. DASH-1 fixed one cross-module
leak of executive content; this pass found another, in a different module.

### MM2-1 — MED — Executive minutes leak to the broad documents audience via publish — ✅ FIXED

**The restriction, and where it holds:** executive-session minutes are visible
only to `minutes.manage` holders. `MinuteService.get_minutes` / `list_minutes` /
`search` / `get_stats` all apply `status == APPROVED AND meeting_type != EXECUTIVE`
for a non-manager (a plain viewer gets a 404, so the existence is hidden), and A7's
DASH-1 extended the same gate to the dashboard action-item feed. The content this
protects is, by the module's own rationale, discipline/termination/legal matters.

**The leak:** `POST /minutes/{id}/publish` (`minutes.manage`) calls
`DocumentService.publish_minutes`, which rendered the **full minutes body** into a
`Document` in the "meeting-minutes" system folder — checking `status == APPROVED`
but **not** `meeting_type`. Executive minutes can be approved, so an approved
executive session could be published. Every documents read path
(`GET /documents/{id}`, `list_documents`, download, summary) gates on
**`documents.view`** — a far broader audience than `minutes.manage` — so the
published copy exposed the executive-session body to members who get a 404 on the
minutes endpoints themselves. The system even tagged the document `executive`
while doing it. This is the DASH-1 shape (cross-module read bypassing the minutes
restriction), via publish → documents instead of the dashboard.

**Why FIXED, not flagged:** it enforces an **already-decided** access-control
policy at a path that silently violated it — the same disposition A7 chose for
DASH-1 (fix the leak, don't re-litigate the policy). `publish_minutes` now refuses
executive-session minutes with `ValueError → 400` (the endpoint's
`handle_service_errors` maps it). No data changes; the approved-status check still
runs first. 3 tests added (`TestPublishMinutesExecutiveGuard`): executive rejected
(as `.value` and as the enum), and the approved-gate-precedes-executive ordering.

**Escape hatch recorded (future dev):** if an org deliberately wants to share an
executive session with a *restricted* audience, that needs a real build (a
restricted document folder, or a `minutes.view_executive` tier — the same tier
MM-3's deferred half wants), not a one-click publish to `documents.view`. Noted in
`KNOWN_LIMITATIONS.md`.

### Not a leak — the reports count (verified)

`reports_service._generate_department_overview` counts open minutes action items
(`open_from_minutes`) across a join to `MeetingMinutes` with no executive filter —
but it returns only a **count**, never content, at `reports.view`. A total that
includes executive items is arguably correct for an overview and discloses
nothing, so it is left as-is (contrast the dashboard, which exposed each item's
description/assignee and so needed the DASH-1 filter). `quorum_service` reads
minutes by id for quorum math only (no content projection).

---

## Pass 1 (2026-08-06)

**Prefix:** `MM2` · **Iteration:** B6 · **Reviewed:** 2026-08-06

**Backend:** `endpoints/meetings.py` (17), `endpoints/minutes.py` (25),
`services/meetings_service.py`, `services/minute_service.py`
**Frontend:** `modules/minutes`
**Prior audit:** `docs/module-audit/meetings-minutes.md` — MM-1/MM-2/MM-3 fixed;
MM-4 (XC-1) and an MM-3 frontend-inconsistency note left open.

---

## Scope

Tier B: worked the two open items. This module connects directly to the earlier
**DASH-1** fix (the dashboard's minutes-visibility gate), so consistency between
the two was a specific check.

## Findings

### MM-4 — LOW — Create/update paths store client FKs unvalidated (XC-1) — ✅ FIXED (all sites)

Closed the whole enumerated cluster with the shared `assert_in_org`:

- `minute_service.create_minutes` — `event_id` (Event) + each inline action
  item's `assignee_id` (User).
- `minute_service.update_minutes` — `event_id` on re-point.
- `minute_service.add_action_item` — `assignee_id`.
- `meetings_service.create_meeting` — the bulk path spread attendee/action-item
  dicts unvalidated (the dedicated `add_attendee` endpoint already validated);
  now each attendee `user_id` and action-item `assigned_to` is checked.
- `meetings_service.create_action_item` — `assigned_to`.

**Impact (verified):** mis-attribution, not disclosure — I checked whether a
foreign `event_id` reads back and it does **not**: `get_minutes` eager-loads
`template` (the MM-1 vector) but **not** `event`, and the response schema exposes
only `event_id`, never event details. So this is the same low-severity dangling-FK
class, closed for consistency and defense-in-depth.

**A latent bug found while wiring the error path:** the `create_minutes`
**endpoint had no `ValueError` handling at all** — so the existing MM-1
`ValueError("Invalid template")` guard was **already** surfacing as a 500, not
the intended 400, and my new MM-4 validations would have done the same. Fixed by
wrapping the call in the module's `handle_service_errors` context manager (which
maps `ValueError → 400`), matching every sibling write endpoint. So this
iteration also quietly corrected MM-1's error contract.

### MM-3-frontend — MEDIUM — `canManage` checked the wrong permission — ✅ FIXED

The MM-3 write-up flagged it and I confirmed it live: `MinutesPage.tsx` and
`MinutesDetailPage.tsx` computed `canManage = checkPermission('meetings.manage')`,
but the backend gates **all 19 minutes write endpoints and the MM-3 restricted
reads on `minutes.manage`**. The mismatch cut both ways:

- A holder of `minutes.manage` **without** `meetings.manage` — the role actually
  empowered to manage minutes — saw **no** management UI at all.
- A holder of `meetings.manage` **without** `minutes.manage` saw edit/approve
  buttons that then **403'd** on click.

**Fix:** both pages now `checkPermission('minutes.manage')`, matching the API,
with a comment explaining the meetings-vs-minutes distinction. This is strictly
corrective — a `meetings.manage`-only user was already being 403'd by the
backend, so no working capability is removed; the UI now tells the truth.

Raised to MEDIUM from the prior note's aside because it silently denied the
correct role its function.

## Verified good ✅ (re-confirmed)

- **DASH-1 consistency:** the dashboard's `minutes_visibility_filter` (added in
  A7) keys on `minutes.manage` and mirrors `MinuteService.get_minutes`'s
  `restricted` branch — the same permission this frontend fix now aligns to.
  The three surfaces (minutes module reads, dashboard action-item feed, minutes
  UI gating) are now consistent on `minutes.manage`.
- MM-1 (template leak), MM-2 (LIKE escaping — `meetings_service.get_meetings`
  confirmed still has `escape="\\"`), MM-3 (restricted reads) all remain fixed.
- XC-3 clean (the prior audit's finding that the ELEC-2 admin-write flaw does not
  recur here) — re-confirmed: every by-id write routes through an org-scoped
  fetch.

## Duplication

The `assert_in_org` calls now appear across five methods in two services — that
is the intended consolidation (one shared helper), not duplication.

## Dead code

None; no TODO/FIXME. The prior audit's cosmetic notes (docstrings titled
"Meeting Minutes …" on the meetings files; the `Meeting.motions` Text vs
`MeetingMinutes.motions` relationship name-collision) remain harmless and are
left as-is.

## Documentation

`docs/module-audit/meetings-minutes.md`: MM-4 now resolved; the MM-3 frontend
inconsistency (previously an aside) is resolved as MM-3-frontend.

## Future development

1. **`minutes.view_executive` tier** (MM-3's deferred half) — still open: if
   board members need executive-session minutes without full `minutes.manage`,
   that needs a new permission (seed + roles + frontend). A deliberate product
   decision, unchanged.
2. **No service test for the new FK guards** — they rest on `test_org_scoping.py`;
   the 132 mock-based minute/meeting tests pass with the added queries.

## Completion gate

| Check | Result |
|-------|--------|
| `tsc --noEmit` | ✅ 0 errors |
| `flake8 app/ tests/` | ✅ 0 violations |
| `black --check` | ✅ 503 files unchanged |
| `eslint` | ✅ clean |
| backend tests | ✅ **2517 passed, 0 failed**; 132 minute/meeting tests pass with the new validation. 648 errors, all `db_session` fixture (no MySQL). |
</content>
