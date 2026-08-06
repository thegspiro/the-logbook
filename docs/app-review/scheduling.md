# Application Review — Scheduling (Tier B, 2nd pass)

**Prefix:** `SCH2` · **Iteration:** B19 · **Reviewed:** 2026-08-06

**Backend:** `endpoints/scheduling.py` (~1,900 L), `services/scheduling_service.py`
(~5,000 L)
**Frontend:** `modules/scheduling`
**Prior audit:** `docs/module-audit/scheduling.md` (iteration 19) — SCH-1 (self-
escalation), SCH-2 (self-signup guards), SCH-3 (DoS), SCH-4 (`shift_officer_id` +
hours-report join) fixed; SCH-5 (swap accept-path), SCH-6 (`manual_hours` + FKs)
left open.

---

## Scope

Tier B: the two open findings. The HIGH self-service escalation/guard/DoS issues
were closed and re-confirmed; XC-3 on the manager paths is solid. Two useful
verifications this pass ruled out phantom findings; the real SCH-6 gap
(`manual_hours` user_id) was fixed and SCH-5 stays flagged as a design change.

## Findings

### SCH-6 — MEDIUM/LOW — `finalize_shift` manual-hours user not org-validated (+ apparatus FK) — ✅ FIXED

- **`finalize_shift` `manual_hours[].user_id` (the real gap).** Finalization
  creates a `ShiftAttendance` row for each manual-hours entry using a
  client-supplied `user_id` with no in-org check — so a foreign user id gets an
  attendance/hours row on **this** org's shift. Now validated via the existing
  `_user_in_org`; a foreign id rejects with "One or more members are not in your
  organization" before any row is written. (The `hours` value is **already**
  bounded at the schema — `ManualHoursEntry.hours: Field(gt=0, le=48)` — so the
  audit's "trusts a client-supplied manual_hours override" concern on the *value*
  is already closed; the gap was the *user*.)
- **`apparatus_id` on `create_shift` / `update_shift`.** Stored a client-supplied
  `apparatus_id` unchecked; it drives the min-staffing lookup. Now validated in-org
  via the shared `is_in_org` (defense-in-depth — `_get_apparatus_map` is already
  org-scoped, so it was backstopped). `station_id` is an unwired "future"
  placeholder column with no reads, so validating it would be a no-op; `template_id`
  is not a `Shift` field (it lives on `ShiftPattern`, validated via the org-scoped
  `get_template_by_id`).

**2 regression tests added** (foreign apparatus on create; foreign manual-hours
user on finalize).

### SCH-5 — MEDIUM — Swap accept-path re-validation & self-approval — 🚩 FLAGGED (design change)

When a swap is *accepted* by the counterparty (vs. manager approval), the target
shift's current state (capacity, cancellation, finalization) is not re-validated at
accept time, and the accept path's approver-identity check is looser than the
manual-review path. Closing it is a behavior change to the swap-accept workflow
(what to re-check, and whether an accept should be blocked on a now-full/cancelled
target) — a design decision, not a drive-by. Recorded in `KNOWN_LIMITATIONS.md`.

## Verified good ✅ (re-confirmed / phantom findings ruled out)

- SCH-1/2/3/4 all hold (self-signup officer-promote guarded by `not self_signup`;
  cancelled/finalized/past-date rejected on self-signup; generation capped at 366;
  `shift_officer_id` org-validated + hours-report `User` join org-scoped).
- **Not a finding — error sanitization:** the service returns `str(e)` on the
  exception path in ~15 methods, but every endpoint wraps it in
  `_safe_detail(...)` → `safe_error_detail(ValueError(error))`, which strips
  SQL/paths — so unlike NOTIF-2/FORM-7 there's no live raw-error leak here.
- **Not a finding — manual `hours` bound:** already `Field(gt=0, le=48)` at the
  schema.

## Documentation

`docs/module-audit/scheduling.md` updated: SCH-6 resolved (manual-hours user +
apparatus); SCH-5 stands.

## Future development

1. **SCH-5** — re-validate the target shift at swap-accept time and tighten the
   accept-path approver-identity check.
2. **SCH-6 station_id/template_id** — validate if/when the station link is wired up.

## Completion gate

| Check | Result |
|-------|--------|
| `flake8` (service + test) | ✅ 0 violations |
| `black --check` | ✅ formatted |
| `tsc --noEmit` | ✅ n/a — no frontend change |
| backend tests | ✅ `test_scheduling_org_scoping` **2 passed** (new). `test_scheduling.py` is DB-backed (70 errors, all the no-MySQL fixture — unchanged from baseline). |
