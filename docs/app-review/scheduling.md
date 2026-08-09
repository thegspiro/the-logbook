# Application Review — Scheduling (Tier B)

**Prefix:** `SCH2` · **Iteration:** B19 · **Reviewed:** 2026-08-06 (pass 1),
2026-08-08 (pass 2)

**Backend:** `endpoints/scheduling.py` (~1,900 L), `services/scheduling_service.py`
(~5,000 L)
**Frontend:** `modules/scheduling`
**Prior audit:** `docs/module-audit/scheduling.md` (iteration 19) — SCH-1 (self-
escalation), SCH-2 (self-signup guards), SCH-3 (DoS), SCH-4 (`shift_officer_id` +
hours-report join) fixed; SCH-5 (swap accept-path), SCH-6 (`manual_hours` + FKs)
left open.

---

## Pass 3 (2026-08-09) — verified clean; latent-500 clears; 7 E712 swept

Re-verified: **SCH-7** — `create_template` validates the client `apparatus_id` in-org
via `apparatus_ref_exists` → "Apparatus not found" (service 1704; `update_template`
mirrors it); **SCH-8** — `get_active_shift_for_apparatus` returns `Optional[Shift]`
(no 500). SCH-1/2/3/4/6 hold; SCH-5 stays flagged.

**Latent-500 lens clears:** the shift enum columns (`assignment_status`,
`pattern_type`, `position`, `status`) are all properly typed / validated in the
`scheduling.py` request schemas — **0** free-string→ENUM fields.

### SCH2-1 — NIT — 7 boolean-column E712 swept — ✅ FIXED

`scheduling_service.py` carried 7 `== True/False  # noqa: E712` comparisons
(`Shift.is_finalized` ×3, `ShiftPattern.is_active`, `MemberLeaveOfAbsence.active` ×2,
`TrainingRequirement.active`) — all boolean columns; converted to `.is_(...)`, now
E712-free.

### Still flagged (unchanged)

- **SCH-5** — swap accept-path re-validation + approver identity (a design change to
  the swap workflow, not a drive-by). **SCH-6 residual** — validate `station_id`/
  `template_id` if/when the station link is wired.

**Completion gate (pass 3):** `flake8` 0 · `black --check` clean · `tsc --noEmit`
n/a (no frontend change) · scheduling tests **109 passed** (DB-free; the `db_session`
errors are the known no-MySQL fixture failures — this module is DB-heavy).

---

## Pass 2 (2026-08-08) — six-lens sweep

Re-verified pass-1 (SCH-1–4, SCH-6; SCH-5 still flagged). Update-bypass is clean
(all update endpoints use `model_dump(exclude_unset=True)`; `ShiftAssignmentUpdate`/
`ShiftAttendanceUpdate` omit `user_id`; `update_shift` re-validates
`shift_officer_id`/`apparatus_id`). **2 fixes.**

### SCH-8 — MED — `GET /apparatus/{id}/active-shift` 500'd on its success path — ✅ FIXED

`get_active_shift_for_apparatus` called `service._get_apparatus_map(
current_user.organization_id)` — but the signature is `_get_apparatus_map(self,
organization_id, apparatus_ids)` with **no default** for `apparatus_ids` (every
other of its four call sites passes both). So the moment an apparatus actually had
an active shift, the enrichment call raised `TypeError` → uncaught `500`. **Fix:**
pass `apparatus_ids=[shift.apparatus_id] if shift.apparatus_id else []`, matching
the other call sites.

### SCH-7 — LOW — `create_template` / `update_template` stored a client `apparatus_id` unvalidated — ✅ FIXED

`create_shift` validates a client `apparatus_id` in-org via `apparatus_ref_exists`;
the template create/update paths funneled straight into `_crud_create`/`_crud_update`
with no such check. A template's `apparatus_id` is stamped onto **every** shift
`generate_shifts_from_pattern` produces, so a foreign id persisted a dangling FK
and silently dropped the min-staffing/checklist wiring on the generated shifts.
Not a read-leak (apparatus enrichment resolves via the org-scoped
`resolve_apparatus_display_map`, so a foreign id renders blank), hence LOW — but the
standard XC-1 shape. **Fix:** the same in-org `apparatus_ref_exists` guard on both
template paths. Swept an adjacent `is_active == True  # noqa: E712` to `.is_(True)`.
2 regression tests (create + update reject a foreign apparatus).

**Flagged (unchanged):** SCH-5 (swap accept-path re-validation + approver identity —
workflow design, KNOWN_LIMITATIONS). Lenses 2–5 clean: name-map reads are fed only
by org-scoped, create-validated ids; swap/time-off/assignment by-id all filter
`organization_id`. Latent-500 otherwise clean (endpoints wrap service `str(e)` in
`_safe_detail`).

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
