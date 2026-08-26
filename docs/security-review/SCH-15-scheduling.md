# Security Review 15 — Scheduling

**Prefix:** `SCH` · **Iteration:** 15 · **Reviewed:** 2026-08-26 · **PR:** TBD

**Backend:** `api/v1/endpoints/scheduling.py` (3,437 L, 92 routes),
`api/v1/endpoints/scheduling_module_config.py` (3 routes),
`api/v1/endpoints/calcom_sync.py` (1 route),
`services/scheduling_service.py` (7,018 L),
`services/scheduling_module_config_service.py`,
`services/standing_shift_service.py` (570 L),
`services/integration_services/calcom_service.py`
**Frontend:** `modules/scheduling` (56 files)
**Migrations:** `20260823_1400_e7a41b6d09c2_add_standing_shift_claims.py` (new
since the last pass); none touched this iteration

---

## Scope

Module-audit iteration 19 (SCH-1 through SCH-8) plus four app-review Tier B
passes (2026-08-06 through 2026-08-09) already covered this module in depth —
this is its first pass through the security-review rotation. Both
`scheduling.py` and `scheduling_service.py` have roughly **doubled in size**
since the last full read (endpoints: ~1,900 → 3,437 L; service: ~5,000 →
7,018 L), so this iteration re-verified every prior finding and read the
entire current file rather than treating the growth as incremental.

**Read in full, not sampled:** `scheduling.py` (all 92 routes, enumerated
below), `scheduling_service.py` (all 7,018 lines), `standing_shift_service.py`
(570 L, new since the last audit — recurring member shift claims, not
previously reviewed), `scheduling_module_config.py` +
`scheduling_module_config_service.py` (department shift-settings CRUD, small,
not previously reviewed), `calcom_sync.py` + `calcom_service.py` (Cal.com
booking read, not previously reviewed).

**Not read line-by-line:** the frontend module (56 files) — checked only for
the cache-exclusion and auth-interceptor checklist items (both already
correct; see Verified good).

## Route inventory

92/92 routes in `scheduling.py` carry an inline auth dependency (either
`Depends(get_current_user)`, `Depends(require_permission(...))`, or an inline
authorization helper) — the router's own `module_gate("scheduling", ...)`
dependency uses the **optional** current-user resolver and passes
unauthenticated requests through, so it provides no authentication of its own;
every route's real gate is the one on the route itself. Confirmed by reading
all 92 handler signatures, not by the module gate's presence.

| Group                                                     | Routes | Gate                                                                                                                                                   |
| --------------------------------------------------------- | -----: | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Shifts CRUD                                               |      5 | `scheduling.view`/`scheduling.manage`; `/shifts/open` self-filtered `get_current_user`                                                                 |
| Shift lifecycle (finalize/closeout/reopen/handoff/cancel) |      9 | `get_current_user` + `_authorize_shift_management`/`_authorize_handoff_access` (manage perm OR shift officer OR, for handoff, an active roster member) |
| Attendance                                                |      6 | mix of `_authorize_shift_management` and `scheduling.view`/`scheduling.manage`                                                                         |
| Self check-in/out + history                               |      4 | `get_current_user`, self-scoped to `current_user.id`                                                                                                   |
| Apparatus active-shift                                    |      1 | `get_current_user`                                                                                                                                     |
| Calendar (week/month)                                     |      2 | `scheduling.view`                                                                                                                                      |
| Summary/dashboard                                         |      4 | `scheduling.view` (summary); `scheduling.manage` (dashboard widgets — deliberately elevated above `.view`, see below)                                  |
| Shift calls                                               |      6 | `_authorize_shift_management` or `scheduling.view`/`scheduling.manage`                                                                                 |
| Templates                                                 |      5 | `scheduling.view`/`scheduling.manage`                                                                                                                  |
| Patterns + generate                                       |      6 | `scheduling.view`/`scheduling.manage`                                                                                                                  |
| Assignments                                               |      8 | mix of `require_permission`, `_authorize_assignment_management`, self-scoped confirm                                                                   |
| Swap requests                                             |     ~9 | `scheduling.swap`/`scheduling.manage`; `respond_to_swap_offer` self-scoped `get_current_user` by design                                                |
| Time-off                                                  |     ~6 | `scheduling.view`/`scheduling.swap`/`scheduling.manage`                                                                                                |
| Availability                                              |      1 | `scheduling.assign`                                                                                                                                    |
| Personal (`/my-shifts`, `/my-assignments`)                |      2 | `get_current_user`, self-scoped                                                                                                                        |
| Reports                                                   |      4 | `scheduling.report`                                                                                                                                    |
| Signup/withdraw                                           |      2 | `get_current_user`, self-scoped                                                                                                                        |
| Standing shifts (preview/claim/list/create/delete)        |      5 | `get_current_user`, self-scoped throughout                                                                                                             |
| Apparatus options + basic-apparatus CRUD                  |     ~6 | reads `get_current_user`; writes `scheduling.manage`                                                                                                   |
| Eligibility (positions/bulk/roster/settings)              |     ~6 | member-facing reads `get_current_user`; roster/settings gated on `scheduling.manage`/`training.view_all`/`training.manage` (OR)                        |
| Department shift settings                                 |      2 | `scheduling.view` (read); `scheduling.manage` (write)                                                                                                  |
| Calendar feed (issue/rotate)                              |      2 | `get_current_user`, self-scoped                                                                                                                        |
| Platoons (overview/bulk-assign)                           |      2 | `scheduling.manage`                                                                                                                                    |

No route was found with zero auth dependency. No route gates a write with a
`.view`-level permission. `/dashboard/widgets` and its preference endpoints
deliberately require `scheduling.manage` rather than the baseline `.view`
grant, with an in-code comment explaining the reasoning (leadership reporting,
not operational data) — a correctly _tightened_ gate, not a weak one.

`scheduling_module_config.py` (3/3 routes: GET self-scoped `get_current_user`,
PUT/DELETE `scheduling.manage`) and `calcom_sync.py` (1/1 route:
`integrations.manage`) are both fully gated.

## Verified good ✅

- **SCH-1 through SCH-8 all still hold**, re-verified against current code,
  not carried forward from the doc: `self_signup=True` still guards the
  officer-auto-promote block (SCH-1); self-signup still rejects
  `CANCELLED`/finalized/past-dated shifts (SCH-2); `MAX_GENERATION_DAYS=366`
  still caps pattern generation (SCH-3); `shift_officer_id` and the
  hours-report `User` join are still org-validated (SCH-4);
  `manual_hours[].user_id` and `create_shift`/`update_shift`'s `apparatus_id`
  are still org-validated (SCH-6); `create_template`/`update_template`'s
  `apparatus_id` is still org-validated (SCH-7); `_get_apparatus_map` is still
  called with both arguments everywhere (SCH-8).
- **Every by-id lookup still filters `organization_id`.** Confirmed for
  `get_shift_by_id`, `get_shift_call_by_id`, `get_template_by_id`,
  `get_pattern_by_id`, `get_assignment_by_id`, `get_swap_request_by_id` /
  `get_swap_request_for_user_by_id`, `get_time_off_by_id` /
  `get_time_off_for_user_by_id`, and (new since the last audit)
  `StandingShiftService.get_claim` — each filters `organization_id` in its
  `WHERE` clause. `ShiftAttendance` has no `organization_id` column of its own;
  `update_attendance`/`remove_attendance` resolve it through a `JOIN Shift`
  that does carry the filter.
- **Every client-supplied foreign-key id is org-validated before being
  stored**, including on surface added since the last audit:
  `save_closeout_attendance`'s `entries[].user_id` (new close-out wizard),
  `_validate_training_slot_fields`'s `training_program_id` /
  `training_evaluator_id` (new training-slot assignment fields),
  `create_swap_request`'s `offering_shift_id` / `requesting_shift_id` /
  `target_user_id` (explicit IDOR-mitigation comment in code),
  `bulk_assign_platoon`'s `user_ids` (explicit "IDOR-safe" comment),
  `StandingShiftService.create`'s `apparatus_id`. One gap found and fixed —
  see SCH-9.
- **Capacity/locking (Pitfall #27) is correct on both the existing and the new
  locking surface.** `create_assignment` / `_validate_assignment_candidate`
  still locks the shift row (`for_update=True`) and both seat-count queries
  (`.with_for_update()`) — unchanged from the shape
  `test_capacity_locking.py::TestShiftSeatCapacity` already guards. New since
  the last audit: `review_swap_request` locks the swap request, then every
  participant `User` row, then every involved `Shift` row, then every involved
  `ShiftAssignment` row, in that order, before mutating; `respond_to_swap_offer`
  (the SCH-5-adjacent self-service accept path) locks the swap request, the
  offering shift, and the offered assignment, then re-validates via
  `_validate_assignment_candidate(..., enforce_capacity=True)` before moving
  the seat. No new count-then-insert pattern anywhere in the file lacks a lock.
- **No SQL injection / no LIKE surface at all** — zero `.like()`/`.ilike()`
  calls in `scheduling_service.py`; the one `text()` use is a static
  `"MINUTE"` literal passed to `func.timestampdiff`, not user input.
- **No Pitfall #12 JSON-mutation violations.** Every JSON-column write
  (`Shift.positions`, `.activities`, `ShiftCall.responding_members`,
  `ShiftTemplate.positions`, `ShiftPattern.schedule_config` /
  `.assigned_members`) either assigns a fresh object wholesale or, in the one
  genuinely-nested case (`reopen_shift`'s `activities` field), rebuilds a new
  dict via comprehension with a comment explaining why in-place mutation would
  be silently dropped.
- **Update payloads correctly distinguish omitted from explicit-null.** All
  five update methods in `scheduling_service.py` iterate only the keys present
  in a `model_dump(exclude_unset=True)` payload, which is the same semantic
  `apply_updates` exists to provide (though this file predates that shared
  utility and doesn't import it — no divergence in behavior found across any
  of the five sites).
- **`calcom_service.py` re-validates its outbound URL at send time.**
  `_assert_base_url_safe()` (→ `assert_outbound_url_safe`) is called
  immediately before every outbound request in both `test_connection` and
  `list_bookings`, closing the DNS-rebinding TOCTOU the checklist calls for —
  this integration's `api_base_url` is org-configurable (self-hosted Cal.com
  support), so it's exactly the case the check exists for.
- **`scheduling_module_config_service.py` deep-copies its module-level
  defaults** before returning them (`copy.deepcopy(DEFAULT_SHIFT_SETTINGS)`,
  with a comment naming Pitfall #12 explicitly) and builds fresh dicts on every
  write via `model_dump()` — no shared-reference aliasing.
- **`standing_shift_service.py` (570 L, new since the last audit) is
  correctly built**: `create()` validates a client-supplied `apparatus_id`
  in-org before storing it (with an explicit Pitfall #14 comment), caps series
  length at `MAX_SERIES_DAYS=366` (same DoS-prevention shape as SCH-3),
  delegates all capacity/eligibility/driver checks to the caller-supplied
  `assign` callable (`SchedulingService.create_assignment`) rather than
  reimplementing them, and its `StandingShiftClaim` model uses
  `ondelete="CASCADE"` (not `SET NULL`) on both foreign keys, so Pitfall #2
  does not apply.
- **`/scheduling/` is already in `UNCACHEABLE_PREFIXES`** in
  `frontend/src/utils/apiCache.ts`, covering every endpoint in this feature
  including the ones added since the last audit. The module's own
  `services/api.ts` uses the shared axios factory for auth/CSRF (Pitfall #7)
  — confirmed via its own `SEC:` comment naming the reason.
- **Separation of duties holds.** Manager swap review rejects both the
  requester and a targeted participant; time-off review rejects the
  submitting member. Rejected reviews leave the request pending, not silently
  approved.

## Findings

### SCH-9 — LOW (XC-1) — `ShiftCall.responding_members` accepted a foreign user id — ✅ FIXED

**What:** `create_shift_call` and `update_shift_call` stored a client-supplied
`responding_members` list (user-id strings) straight into the `ShiftCall.
responding_members` JSON column with no in-org check — the one client-supplied
user-id write path in this file that didn't follow the pattern every other one
does (`manual_hours[].user_id`, `attendance_data.user_id`,
`save_closeout_attendance`'s `entries[].user_id`, `create_swap_request`'s
`target_user_id`, all of which validate via `_user_in_org` or an equivalent
before persisting).

**Where:** `app/services/scheduling_service.py` — `create_shift_call`
(was line 2052) and `update_shift_call` (was line 2100).

**Failure scenario:** `compute_member_call_counts` sums `responding_members`
across a shift's calls to credit each member a call count
(`app/services/scheduling_service.py:677-691`), and
`ShiftCompletionService._get_trainee_call_data_from_shift` searches the same
column for a trainee's user id to compute their call-response count on a
training report. A caller with `scheduling.manage` (or shift-officer access
via `_authorize_shift_management`) who supplies a foreign org's user id in
`responding_members` would, if that id happened to be known and reused,
inflate that unrelated user's call count on a report they have nothing to do
with. Not a read-leak — nothing resolves the id to a name from this column —
but a data-integrity write outside the caller's org, the class Pitfall #14c
exists to close.

**Impact:** LOW. Requires already holding shift-management access, and the
only effect is a miscounted statistic on an unrelated org's member (no PII
disclosed, no write to another org's own tables). Recorded as a finding rather
than skipped because it's the one exception to an otherwise-universal
discipline in this file, and the fix is small and low-risk.

**Fix:** both methods now validate every id in `responding_members` via the
same `_user_in_org` helper used everywhere else in this file, rejecting with
"One or more members are not in your organization" before the write — `create
_shift_call` before `self.db.add(call)`, `update_shift_call` before the
`setattr` loop (only when the key is present in the update payload, so an
update that doesn't touch `responding_members` isn't penalized with an extra
query). Guard tests:
`test_scheduling_org_scoping.py::TestShiftCallRespondingMembersScoping` (2
tests: create and update each reject a foreign id and leave no row
written/changed).

## Schema & migration notes

`standing_shift_claims` (added `20260823_1400_e7a41b6d09c2`) is the only table
this feature owns that's new since the last audit. Both foreign keys
(`organization_id`, `user_id`) use `ondelete="CASCADE"` with `nullable=False`
— not `SET NULL`, so Pitfall #2's nullability requirement doesn't apply.
Indexed on `(organization_id, is_active, weekday)` for the shift-creation
reader's lookup pattern. No other schema changes this iteration; migration
chain validated at a single head (`b272a5d5535c`, 371 revisions).

## Guard tests added

- `test_scheduling_org_scoping.py::TestShiftCallRespondingMembersScoping` — 2
  tests (create, update), asserting SCH-9: a foreign `responding_members` id
  is rejected before any write, with the same message and mechanism
  (`_user_in_org`) as the file's other client-supplied-user-id checks.

## Completion gate

| Check                                                                                                                                                                                    | Result                                                          |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `flake8 app/ tests/ alembic/` (changed files)                                                                                                                                            | ✅ 0 violations                                                 |
| `black --check app/ tests/ alembic/` (changed files)                                                                                                                                     | ✅ clean                                                        |
| `isort --check-only app/ tests/ alembic/` (changed files)                                                                                                                                | ✅ clean                                                        |
| `python3 scripts/validate_migrations.py --strict`                                                                                                                                        | ✅ single head, 371 revisions                                   |
| `pytest tests/test_scheduling_org_scoping.py tests/test_scheduling.py tests/test_call_tracking.py tests/test_scheduling_module_config_service.py tests/test_calcom_bookings_endpoint.py` | ✅ 194 passed                                                   |
| `pytest tests/` (full backend suite)                                                                                                                                                     | ✅ 8544 passed, 22 skipped (pre-existing Docker/no-MySQL skips) |
| `tsc --noEmit` / `eslint .`                                                                                                                                                              | n/a — no frontend file changed this iteration                   |
