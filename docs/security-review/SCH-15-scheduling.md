# Security Review 15 — Scheduling

**Prefix:** `SCH` · **Iteration:** 15 · **Reviewed:** 2026-08-26 · **PR:** [#1846](https://github.com/thegspiro/the-logbook/pull/1846)

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

## Revision note

Two rounds of Codex review corrected this draft. The first caught three
issues: a real efficiency gap (SCH-9's original per-id validation loop, up
to 100 serial queries) and two inaccurate claims in the draft's own
write-up — SCH-9's cross-tenant impact was overstated (there is no
cross-tenant failure scenario; corrected below), and a "Verified good" claim
that `calcom_service.py` closes the DNS-rebinding TOCTOU was wrong (it
narrows the window; filed as SCH-10, flagged). The second round caught that
the SCH-10 correction itself undercounted the affected surface — six files
sharing one fix, when it's actually **seven callers across three distinct
transports**, two of which (a hand-built `httpx.AsyncClient` in
`audit_ship_service.py`, and `pywebpush` in `push_service.py`) would not be
reached by the single shared-client fix the first correction implied.
SCH-9's fix (in-org validation) survives, batched; SCH-10 is flagged rather
than fixed either way, since closing it is a cross-cutting change spanning
multiple transports, not a scheduling-specific one.

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
- **`calcom_service.py` re-validates its outbound URL immediately before
  every outbound request** (`_assert_base_url_safe()` in both
  `test_connection` and `list_bookings`) — the pattern the checklist calls
  for, applied correctly to this integration's org-configurable
  `api_base_url` (self-hosted Cal.com support). **Correction, not a finding:**
  this narrows the DNS-rebinding TOCTOU window, it does not close it — see
  SCH-10, a pre-existing, repo-wide gap rather than a defect in this file.
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

### SCH-9 — NIT (referential integrity, not cross-tenant) — `ShiftCall.responding_members` accepted a foreign user id — ✅ FIXED

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

**Corrected impact (was overstated in the draft; caught by Codex review):**
the draft claimed a foreign id here could "inflate an unrelated org's
member's call count." It cannot. `compute_member_call_counts` is scoped to
one shift's own (already org-validated) attendance rows and only looks up
each attendee's own id in the count map
(`app/services/scheduling_service.py:6401-6403`) — a foreign id in the map
simply has no attendee to match. `ShiftCompletionService`'s trainee lookup is
the same shape: it validates `trainee_id` is in-org (or the shift is)
_before_ searching `responding_members` for it
(`shift_completion_service.py:282-310`), and searches only the one
already-org-scoped `shift_id` passed in — never scans other shifts or other
orgs for a matching id. So a foreign id here can never attribute a count to,
or affect a report for, another organization's member. There is no
cross-tenant failure scenario.

**Actual impact:** within-org referential integrity only. An org could store
an arbitrary or foreign-looking string as a "responder" on its own shift
call, which is inert noise (no attendee will ever match it) rather than a
security issue — but it's still the one write path in this file that didn't
validate a client-supplied user id, and the fix costs nothing.

**Fix:** both methods now validate every id in `responding_members` via a new
batched `_all_users_in_org` helper (one `IN` query rather than one
`_user_in_org` call per id — the schema allows up to 100 entries per payload,
so a per-id loop could cost 100 serial round trips; also caught by Codex
review), rejecting with "One or more members are not in your organization"
before the write — `create_shift_call` before `self.db.add(call)`,
`update_shift_call` before the `setattr` loop (only when the key is present
in the update payload). Guard tests:
`test_scheduling_org_scoping.py::TestShiftCallRespondingMembersScoping` (4
tests: create/update each reject a foreign id and a partial match, and
create accepts a fully in-org list).

### SCH-10 — LOW/MED (correction; repo-wide, not scheduling-specific) — the DNS-rebinding TOCTOU is narrowed, not closed — 🚩 FLAGGED

**What:** the draft of this review claimed `calcom_service.py` "closes the
DNS-rebinding TOCTOU" by calling `assert_outbound_url_safe()` immediately
before each outbound request. Caught by Codex review: it does not close it.
`assert_outbound_url_safe` resolves the hostname once via
`socket.getaddrinfo()` to check it isn't private (`app/utils/
url_validator.py:105-116`), then returns — the actual request is a separate,
ordinary `httpx.AsyncClient.get()` call (`calcom_service.py:106-111,132-137`)
that performs its **own** independent DNS resolution when it connects. A
hostname that resolves to a public IP for the validation check and an
internal IP moments later for the connection (classic DNS rebinding) passes
the check and still reaches the internal address. The function's own
docstring is accurate about this and the draft's "Verified good" claim was
not: it says the check "shrink[s] the rebinding window... versus
save-time-to-send," not that it closes it.

**Where:** not specific to this feature. `assert_outbound_url_safe` has
**seven** callers across three transports — corrected after a second Codex
review caught this write-up's own first draft undercounting them as six and
implying one shared fix would cover all of them:

- Five go through the shared `create_integration_client()` (plain
  `httpx.AsyncClient`) and would share one remediation:
  `integration_services/{teams,webhook,slack,discord,calcom}_service.py`.
- `audit_ship_service.py` constructs its own `httpx.AsyncClient` directly,
  not through `create_integration_client` — a fix to the shared factory
  alone would not reach it.
- `push_service.py`'s `_send_one` dispatches through `pywebpush.webpush()`,
  not `httpx` at all — a synchronous library with its own connection
  handling, needing its own transport-specific fix rather than the
  httpx-level one the other five share.

`calcom_service.py` follows the established repo pattern correctly; the
pattern itself is the gap, and it is not one gap but (at least) three.

**Impact:** LOW/MED. Requires an attacker who controls DNS for a domain an
org has configured as an integration endpoint (webhook URL, self-hosted
Cal.com host, audit-ship collector) to flip its resolution within the
narrow window between the check and the connect — a real but hard-to-land
SSRF variant, not a trivially exploitable one.

**Fix:** not applied here. Closing this properly means pinning the
validated, resolved address for the actual connection (while preserving the
original Host header / SNI), separately for each of the three transports
above — not one shared-infrastructure change, and not a scheduling-module
fix, and a behavior change to how every integration
connects. Flagged for a dedicated cross-cutting pass (the shape SEC-00 exists
for), not fixed unilaterally here. Mirrored into `docs/KNOWN_LIMITATIONS.md`.

## Schema & migration notes

`standing_shift_claims` (added `20260823_1400_e7a41b6d09c2`) is the only table
this feature owns that's new since the last audit. Both foreign keys
(`organization_id`, `user_id`) use `ondelete="CASCADE"` with `nullable=False`
— not `SET NULL`, so Pitfall #2's nullability requirement doesn't apply.
Indexed on `(organization_id, is_active, weekday)` for the shift-creation
reader's lookup pattern. No other schema changes this iteration; migration
chain validated at a single head (`b272a5d5535c`, 371 revisions).

## Guard tests added

- `test_scheduling_org_scoping.py::TestShiftCallRespondingMembersScoping` — 4
  tests, asserting SCH-9: create and update each reject a foreign
  `responding_members` id, update rejects a partial match (one valid id
  alongside one foreign id), and create accepts a fully in-org list —
  exercising the batched `_all_users_in_org` check rather than the
  since-replaced per-id loop.

## Completion gate

| Check                                                                                                                                                                                    | Result                                                          |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `flake8 app/ tests/ alembic/` (changed files)                                                                                                                                            | ✅ 0 violations                                                 |
| `black --check app/ tests/ alembic/` (changed files)                                                                                                                                     | ✅ clean                                                        |
| `isort --check-only app/ tests/ alembic/` (changed files)                                                                                                                                | ✅ clean                                                        |
| `python3 scripts/validate_migrations.py --strict`                                                                                                                                        | ✅ single head, 371 revisions                                   |
| `pytest tests/test_scheduling_org_scoping.py tests/test_scheduling.py tests/test_call_tracking.py tests/test_scheduling_module_config_service.py tests/test_calcom_bookings_endpoint.py` | ✅ 196 passed                                                   |
| `pytest tests/` (full backend suite)                                                                                                                                                     | ✅ 8546 passed, 22 skipped (pre-existing Docker/no-MySQL skips) |
| `tsc --noEmit` / `eslint .`                                                                                                                                                              | n/a — no frontend file changed this iteration                   |
