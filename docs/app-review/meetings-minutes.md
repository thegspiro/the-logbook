# Application Review — Meetings & Minutes (Tier B, 2nd pass)

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
