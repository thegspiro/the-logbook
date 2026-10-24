# Application Review — Scheduling (Tier B)

**Prefix:** `SCH2` · **Iteration:** B19 · **Reviewed:** 2026-08-06 (pass 1),
2026-08-08 (pass 2), 2026-08-09 (pass 3), 2026-08-09 (pass 4),
2026-10-24 (pass 5)

**Backend:** `endpoints/scheduling.py` (~1,900 L), `services/scheduling_service.py`
(~5,000 L)
**Frontend:** `modules/scheduling`
**Prior audit:** `docs/module-audit/scheduling.md` (iteration 19) — SCH-1 (self-
escalation), SCH-2 (self-signup guards), SCH-3 (DoS), SCH-4 (`shift_officer_id` +
hours-report join) fixed; SCH-5 (swap accept-path), SCH-6 (`manual_hours` + FKs)
left open.

---

## Pass 5 (2026-10-24) — three update routes accepted a null they could not store (3 fixed)

Lens for this pass: the update-payload contract (omit = keep, `null` = clear, a value =
set), driven through the real handlers with the method B18 used on training. A test reads
each `PATCH` route's request and response schemas from the application's own OpenAPI
document, builds a row from the model, and sends `null` for every field the request
schema accepts. A field must be **refused** (exactly 400 or 422, value unchanged, row
still readable) when its column is NOT NULL or its response field cannot hold `None`, and
must **clear** otherwise. Seven routes: shifts, attendance, calls, templates, patterns,
assignments and basic apparatus. 67 cases; 7 failed.

Also checked: all 108 scheduling endpoints carry an auth dependency (an AST scan of the
router found none without `require_permission` or `get_current_user`), and the three
`PUT` settings routes (`/settings`, `/eligibility/settings`, `/dashboard/widget-preferences`)
type their fields non-Optional, so a null is already a 422. Shifts, attendance, templates
and patterns, which route through `reject_null_for_required`/`apply_updates` from the
earlier passes, came back clean in every case.

### SCH2-2 — LOW/MED — a null on three basic-apparatus fields answered 500 — ✅ FIXED

`PATCH /scheduling/apparatus/{id}` wrote the payload with a bare `setattr` loop. `name`,
`unit_number` and `apparatus_type` are NOT NULL, so each failed at the flush (500, the
session rolled back). **Fixed** by writing through `apply_updates`, with the `ValueError`
returned as 400.

### SCH2-3 — LOW/MED — a null on three call fields was stored and made the call unreadable — ✅ FIXED

`incident_type`, `cancelled_en_route` and `medical_refusal` are nullable columns behind
response fields that are plain `str` / `bool`. `update_shift_call` wrote the payload with
`setattr`, so a null was committed and every later read of that call failed response
validation (500) until the row was repaired by hand. **Fixed** in two places: the service
writes through `apply_updates` (which also reports a field the model lacks instead of
dropping it), and `ShiftCallUpdate` refuses a null on those three fields with a 422. The
frontend `ShiftCallUpdate` type already excludes null for them, so the app's own form
could not send one; the exposure was a direct client holding `scheduling.manage`.

### SCH2-4 — LOW — a null seat on an assignment was acknowledged and ignored — ✅ FIXED

`update_assignment` popped a null `position` from the payload on purpose ("a null cannot
clear a NOT NULL seat, so it means leave the seat alone"). The effect was a 200 for a
request that changed nothing, which is the mirror image of the bug the update contract
exists to prevent: the caller is told it worked. A null now reaches
`reject_null_for_required` and answers 400 like every other required field. The only
caller of `update_assignment` is the endpoint, and the one UI use sends a seat or leaves
it out, so no existing flow depended on the old behaviour. A seat that is not on the
shift is still refused, which a new test pins.

### Not done

- **`PATCH /shifts/{id}/closeout/attendance` and `/closeout/calls`** take their own
  request bodies rather than an update schema and are not in the derived test.
- **The harness is a copy of the one in `test_training_update_endpoints_integration.py`**
  (B18, PR #3659), with only the route table and fixture names changed. Once that merges,
  it should move to a shared test helper that both files import.
- **`ShiftCallUpdate._refuse_null` duplicates `RefusesNull`** from the same PR. It is a
  local validator here because the base class is not on `main` yet; it should inherit it
  once it is.
- The other five checklist dimensions were not re-run beyond the auth scan above; passes
  1–4 stand, and SCH-5 (swap accept-path) and the SCH-6 residual stay flagged as before.

**Completion gate (pass 5):** `flake8 app/ tests/` 0 · `black --check app/ tests/` clean ·
`isort` clean on the changed files · `mypy` on the three changed modules clean ·
`check_route_permissions.py --strict` 0 errors · no frontend change · new file
`test_scheduling_update_endpoints_integration.py` 71 pass (7 of the 67 derived cases failed
before the three fixes) with 2,398 other tests selected by
`sched|shift|assign|apparatus|call_track|position|model_updates|capacity` · 0 selected
under the unit job's marker expression.

---

## Pass 4 (2026-08-09) — invariants re-verified, no code change

Re-verified: **SCH-7** `create_template`/`update_template` validate the client
`apparatus_id` in-org (`apparatus_ref_exists`); **SCH-8** `_get_apparatus_map`
called with both args (no `TypeError` 500); SCH-1/2/3/4/6 hold; update-bypass clean
(`model_dump(exclude_unset=True)`, FK re-validation on `update_shift`);
`scheduling_service.py` E712-free; latent-500 lens clear (shift enum fields typed
in the request schemas).

Open items unchanged: **SCH-5** (swap accept-path re-validation + approver identity
— a swap-workflow design change, not a drive-by) and **SCH-6 residual** (validate
`station_id`/`template_id` _if/when_ the station link is wired — conditional on a
feature not yet built).

**Completion gate (pass 4):** no code changed; `flake8` 0 · `black --check` clean ·
`tsc --noEmit` n/a.

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
  audit's "trusts a client-supplied manual_hours override" concern on the _value_
  is already closed; the gap was the _user_.)
- **`apparatus_id` on `create_shift` / `update_shift`.** Stored a client-supplied
  `apparatus_id` unchecked; it drives the min-staffing lookup. Now validated in-org
  via the shared `is_in_org` (defense-in-depth — `_get_apparatus_map` is already
  org-scoped, so it was backstopped). `station_id` is an unwired "future"
  placeholder column with no reads, so validating it would be a no-op; `template_id`
  is not a `Shift` field (it lives on `ShiftPattern`, validated via the org-scoped
  `get_template_by_id`).

**2 regression tests added** (foreign apparatus on create; foreign manual-hours
user on finalize).

### SCH-5 — MEDIUM — Swap accept-path re-validation & self-approval — ✅ RESOLVED (security review SCH-15 pass 2, 2026-08-28)

When a swap is _accepted_ by the counterparty (vs. manager approval), the target
shift's current state (capacity, cancellation, finalization) is not re-validated at
accept time, and the accept path's approver-identity check is looser than the
manual-review path. Closing it is a behavior change to the swap-accept workflow
(what to re-check, and whether an accept should be blocked on a now-full/cancelled
target) — a design decision, not a drive-by. Recorded in `KNOWN_LIMITATIONS.md`.

**Resolved by a later redesign:** `respond_to_swap_offer` (added 2026-08-24)
replaced the general swap-accept path with a narrower one-way-offer accept;
every two-way exchange still goes exclusively through the manager-review path
above, which already re-validates and enforces separation of duties. The
one-way accept path re-validates capacity/cancellation/finalization at accept
time and enforces a strict identity check on the responder. See
`docs/security-review/SCH-15-scheduling.md` → Pass 2 and the corrected entry
in `KNOWN_LIMITATIONS.md`.

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

1. ~~**SCH-5** — re-validate the target shift at swap-accept time and tighten the
   accept-path approver-identity check.~~ ✅ Resolved 2026-08-24 by the
   `respond_to_swap_offer` redesign; confirmed by security review SCH-15 pass 2
   (2026-08-28).
2. **SCH-6 station_id/template_id** — validate if/when the station link is wired up.

## Completion gate

| Check                     | Result                                                                                                                                                  |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `flake8` (service + test) | ✅ 0 violations                                                                                                                                         |
| `black --check`           | ✅ formatted                                                                                                                                            |
| `tsc --noEmit`            | ✅ n/a — no frontend change                                                                                                                             |
| backend tests             | ✅ `test_scheduling_org_scoping` **2 passed** (new). `test_scheduling.py` is DB-backed (70 errors, all the no-MySQL fixture — unchanged from baseline). |
