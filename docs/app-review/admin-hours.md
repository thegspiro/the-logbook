# Application Review — Admin Hours (Tier B, 2nd pass)

**Prefix:** `AH2` · **Iteration:** B15 · **Reviewed:** 2026-08-06

**Backend:** `endpoints/admin_hours.py` (1,042 L, 27 endpoints),
`services/admin_hours_service.py` (1,545 L), model `models/admin_hours.py`
**Frontend:** `modules/admin-hours`
**Prior audit:** `docs/module-audit/admin-hours.md` (iteration 15) — AH-1 (HIGH
self-credit), AH-2 (cross-tenant stale-session mutation), AH-3, AH-4 (SoD) fixed;
AH-5 (minor scoping omissions, flagged not-exploitable) left open.

---

## Scope

Tier B: the one open finding plus the broader lens. This is a clean module — the
time-integrity and self-service-ownership guarantees were re-confirmed (clock-out
duration computed server-side, no member-callable edit/delete, approvals org-scoped
and SoD-guarded). AH-5 was the only remaining item.

## Findings

### AH-5 — LOW — Minor scoping omissions — ✅ FIXED (defense-in-depth)

Three internal queries filtered a narrower key than `organization_id`. None were
exploitable (each was already constrained by an org-verified parent or the
one-org-per-user invariant), but the codebase's standard is that every by-id /
aggregate query is org-scoped, so all three are now uniform:

- **`_get_active_session`** (and `get_active_session`) — took only `user_id`; both
  now take and filter `organization_id`, and `get_active_session`'s category read
  is org-scoped too. The endpoint passes `current_user.organization_id`.
- **`_check_overlap`** — filtered `user_id` only; now also filters
  `organization_id` (the manual-entry overlap check).
- **`delete_category`** active-session count — now filters `organization_id`
  alongside `category_id`.

`AdminHoursEntry.organization_id` already exists, so these are pure filter
additions with no schema change. **2 regression tests added**
(`TestOrgScopedQueries`) asserting the `organization_id` predicate is present in
the compiled `_get_active_session` and `_check_overlap` queries.

## Verified good ✅ (re-confirmed)

- AH-1 (manual entries always start PENDING; `clock_out_at <= now`; 24h cap),
  AH-2 (`auto_close_stale_sessions` takes an optional org; endpoint scoped, cron
  global), AH-3 (`approved_at` stamped on auto-approval), AH-4 (approve calls the
  shared `assert_different_person` SoD guard) all hold.
- 27 endpoints authed; writes/approvals require `admin_hours.manage`; clock-out
  duration computed server-side (no client-trusted duration, no negative); no
  member-callable edit/delete; `create_manual_entry` stamps `user_id` from the
  caller (no impersonation).

## Dead code / duplication

None found. No TODO/FIXME.

## Documentation

`docs/module-audit/admin-hours.md` updated: AH-5 resolved. The AH-4 note (SoD is
unconditional; a sole-officer department needs a second `admin_hours.manage`
holder) stands as the accepted ISO 27001 A.5.3 posture.

## Future development

1. **Per-org SoD toggle** (AH-4 refinement) — only if a genuine sole-officer
   workflow proves necessary; the shared guard is currently unconditional by
   design.

## Completion gate

| Check | Result |
|-------|--------|
| `flake8` (service + endpoint + test) | ✅ 0 violations |
| `black --check` | ✅ formatted |
| `tsc --noEmit` | ✅ n/a — no frontend change |
| backend tests | ✅ `test_admin_hours_service` **19 passed** (+2 new `TestOrgScopedQueries`). No DB needed for this file. |
