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

---

## Pass 2 (2026-08-28) — 0 fixes, 1 stale-doc correction (SCH-5 resolved), 0 new findings

**PR:** #1966 · **Scoped since pass 1's merge:** `5d19cefa` (PR #1847, the
Codex-follow-up merge — the final state pass 1's doc reflects, not the earlier
`c92f0438`/#1846 merge that preceded it).

### Scope

`git diff --stat 5d19cefa..HEAD` on the three declared endpoint files plus
`scheduling_service.py`, `scheduling_module_config_service.py`,
`standing_shift_service.py`, `integration_services/calcom_service.py` shows
real (non-byte-identical) churn in three files: `scheduling.py` (+20/-20),
`scheduling_service.py` (+6/-1), `scheduling_module_config_service.py`
(+70/-0, all-new). No new migration touches a scheduling table (`shifts`,
`shift_assignments`, `shift_swap_requests`, `shift_calls`, `shift_templates`,
`shift_patterns`, `shift_time_off`, `standing_shift_claims`) since pass 1.

**Adjacent-file grep, per the EC-14 lesson** (files referencing `ShiftCall`,
`ShiftSwapRequest`, `ShiftAssignment`, `StandingShiftClaim`,
`SchedulingService`, `standing_shift_service`, `calcom_service`,
`scheduling_module_config` outside the declared list, changed since
`5d19cefa`): `api/v1/api.py` and `models/__init__.py` (both incidental —
adding the unrelated new Testing Checklist module's router/model imports, no
scheduling-relevant lines touched); `models/training.py` (+23/-1, the
`grants_qualification` column on `TrainingCourse` — unrelated to scheduling —
plus a new `ShiftPosition.PARAMEDIC` member, reviewed below);
`schemas/scheduling.py` (+18/-3, `ShiftPosition.PARAMEDIC` +
`PositionEligibilitySource.expires_on`, reviewed below);
`email_template_service.py` (+2, an unrelated inventory-feature docstring
key, no code path); `nfc_tag_service.py` (+15/-5, the AP-13 pass 2 fix already
reviewed and merged under that rotation feature, not this one);
`scheduled_tasks.py` (+168/-30, CRON2-31 dedup/rollback-safety fixes to the
shift-start-reminder and post-shift-validation cron tasks, reviewed below);
`shift_eligibility_service.py` (+90/-43, a real security fix — reviewed
below — landed via a different feature's PR, already applied by Codex on that
PR, not newly found here).

**Frontend, swept broadly rather than scoped to `modules/scheduling/`** (the
same correction feature 06's pass 2 had to make for `BallotBuilder.tsx`):
`modules/scheduling/` (56 files, 4 changed — `services/api.ts`,
`types/index.ts`, `types/shiftSettings.ts`, and
`ApparatusTypeDefaultsCard.tsx` — all reviewed below) plus, **newly
identified this pass**, `pages/scheduling/` — 81 files, ~34,000 lines,
**never mentioned in any prior scheduling review** (module-audit, app-review,
or SCH-15 pass 1 — confirmed by grep, zero hits for the path in any of the
three). This directory holds real scheduling UI outside `modules/scheduling/`
proper: the shift board (`board/ShiftBoard.tsx`, `MonthGrid.tsx`,
`DayDetailPanel.tsx`, `GiveUpShiftModal.tsx`, `StandingShiftModal.tsx`,
`ShiftSeatList.tsx`, `PhoneDaySheet.tsx`, `PhoneMonth.tsx`), `MyShiftsTab.tsx`,
`OpenShiftsTab.tsx`, `RequestsTab.tsx`, `ShiftCloseoutWizard.tsx`,
`ShiftReportsTab.tsx`, `PositionRosterPage.tsx`, `SchedulingPlatoonsPage.tsx`,
`SchedulingSettingsPage.tsx`, `DriverExceptionsPanel.tsx`, and more — alongside
a large amount of equipment-check UI already covered by EC-14's own frontend
sweep (`EquipmentCheckForm.tsx`, `CheckLogPage.tsx`, `CheckLap.tsx`, etc.,
which live in the same directory). Only **one** file under `pages/scheduling/`
changed since pass 1 (`PositionRosterPage.tsx` + its test, +72/-11) — read in
full (below). The other 79 files were swept with the same targeted greps
EC-14 used for its equipment-check frontend pages
(`window.confirm`/`alert`/`prompt`, `dangerouslySetInnerHTML`, banned
`.toLocale*`, direct `fetch()`) rather than read line-by-line — noted as
partial-scope, not assumed clean, consistent with how EC-14 pass 2 flagged its
own equivalent grep-only sweep.

### Verified good ✅ (re-confirmed by reading the current code, not re-citing the doc)

- **Route/permission enumeration re-run from scratch** (AST walk over all
  three endpoint files, not a diff against pass 1's table): **96/96 routes**
  (92 + 3 + 1, unchanged) carry a recognized auth dependency
  (`get_current_user`, `require_permission(...)`, or
  `get_optional_current_user`) — 0 routes with no auth dependency. Matches
  pass 1's inventory with no regression.
- **SCH-9's fix is intact at its current lines**: `create_shift_call`
  (`scheduling_service.py:2057-2098`) and `update_shift_call`
  (`:2128-2152`) both still call the batched `_all_users_in_org` guard before
  persisting `responding_members`, unchanged in shape from pass 1.
- **SCH-10 remains accurately flagged** and is already being tracked
  cross-cuttingly outside this feature: `KNOWN_LIMITATIONS.md`'s entry was
  updated by the training-extended pass (TRX-18) to 8 call sites (was 7 at
  SCH-15 pass 1); no correction needed from this pass.
- **`ShiftPosition.PARAMEDIC`** (new enum member, `models/training.py`,
  `schemas/scheduling.py`) backs a MySQL `Enum(...)` DDL column
  (`shift_assignments.position`, `standing_shift_claims.position` — confirmed
  by reading the column definitions directly, not assumed) and needs no
  migration: `standing_shift_claims`/`shift_assignments` are both listed in
  `app/utils/enum_normalization.py`'s `_TARGET_COLUMNS`, which widens the
  live MySQL `ENUM(...)` DDL to match the Python enum's current value set on
  **every** startup (`main.py:1510`, unconditional, not fresh-install-only) —
  confirmed by reading `_normalize_one`'s comparison
  (`set(current) == set(target)`) rather than assuming the comment's claim.
- **`apparatus_type_defaults_for_org`** (new, `scheduling_module_config_service.py`)
  reads `Organization.organization_type` filtered on the caller's own
  `organization_id` (never a client-supplied id) — no tenant-isolation or
  injection surface; a read-only display concern (EMS-only orgs no longer see
  fire apparatus types in the picker fallback).
- **The RBAC-position-eligibility fix is real and already applied**
  (`a72fed15`, authored by Codex on a different feature's PR, landed on `main`
  before this pass): `shift_eligibility_service.py` no longer resolves a
  member's _held RBAC position_ (an org-chart/role slug like `captain`) as a
  source of _operational_ shift-position eligibility — the removed comment in
  the diff states the reason directly: a role manager could otherwise create
  a position and grant themselves shift eligibility through it. Verified by
  reading the current `_get_slug_eligibility_map`/`get_eligible_positions`,
  not by trusting the commit message: the map is built only from
  `operational_ranks` and qualification/training data now, and
  `_get_held_position_slugs`'s result is deliberately discarded (called and
  ignored, per the inline comment, "for compatibility with lightweight
  session adapters"). Also verified: the new `_account_is_active` gate runs
  **ahead of** the open-to-all-shift bypass in both `get_eligible_positions`
  and `get_eligible_positions_bulk`, so a retired/suspended member cannot
  self-signup for an open-to-all shift on a session opened before their
  status changed.
- **`scheduled_tasks.py`'s CRON2-31 changes to the two scheduling-specific
  cron tasks** (`run_shift_reminders`, `run_post_shift_validation`) are
  dedup/rollback-safety correctness fixes, not security changes, and remain
  org-scoped throughout: both iterate `Organization` rows and issue every
  inner query filtered to `Shift.organization_id == str(org.id)` (or against
  ids drawn from that already-org-scoped shift), the same pattern EC-14 pass
  2 verified for the equipment-check reminder task in this same file.
- **`ShiftReportsTab.tsx`'s auto-save draft** (`saveDraft`/`loadDraft`/
  `deleteDraft` from `utils/shiftReportDrafts.ts`, `shift-report-draft-*`
  localStorage keys) is swept by the same `clearAllDrafts()` logout purge
  EC-14 pass 2 confirmed for the equipment-check draft namespace — traced
  here for the first time specifically against the scheduling shift-report
  key: `clearAllDrafts()` matches both `DRAFT_KEY_PREFIX` ("shift-report-draft-")
  and `EQUIPMENT_CHECK_DRAFT_KEY_PREFIX`, and the file's own `SEC (FE-6)`
  comment names member PII/operational notes as the reason.
- **`PositionRosterPage.tsx`** (the one `pages/scheduling/` file that
  changed since pass 1) read in full: the new qualification-expiry badge uses
  `formatCalendarDate`/`calendarDaysFromToday` from the approved
  `dateFormatting.ts` (no banned `.toLocale*`/raw `Date` formatting), and
  every rendered `source.label` goes through plain JSX text interpolation
  (React-escaped), never `dangerouslySetInnerHTML` — no XSS surface from the
  new training-program/qualification label text.

### Findings

#### SCH-11 — NIT (doc correction) — SCH-5 was already resolved, not open — ✅ FIXED (docs only)

**What:** `KNOWN_LIMITATIONS.md` (two separate rows), `docs/module-audit/scheduling.md`,
and `docs/app-review/scheduling.md` all still described SCH-5 ("swap
accept-path skips target re-validation + a looser approver-identity check
than manager review") as **Open**, deferred for an owner decision. SCH-15
pass 1 (2026-08-26) noted the current `respond_to_swap_offer` method in its
"Verified good" section as "SCH-5-adjacent" — reviewed for capacity locking
(Pitfall #27) — but never connected that to closing the SCH-5 finding itself,
so the stale "Open" status persisted through pass 1 unchanged.

**Where:** `docs/KNOWN_LIMITATIONS.md` (both the combined SCH-5/6 row and the
standalone SCH-5 row), `docs/module-audit/scheduling.md:71`,
`docs/app-review/scheduling.md:134,162`.

**Investigation:** `respond_to_swap_offer` (`scheduling_service.py:4263-4409`,
introduced `0fd34614`, 2026-08-24 — two days before pass 1, not new this
pass) is a deliberate redesign, not a partial fix: it replaced the general
"accept a swap" path with a narrower **one-way offer** accept, and the
docstring states explicitly that "a two-way exchange moves two rosters and
stays with the manager review that exists for it" — confirmed by reading
`respond_to_swap_offer` itself (rejects with "A two-way swap has to be
reviewed by a duty officer" whenever `requesting_shift_id` is set) and by
enumerating the swap-request routes (`get`, `review`, `respond`, `cancel` —
no fifth "self-accept a two-way swap" route exists). Both SCH-5 sub-claims no
longer hold against the current code:

- **"Target shift's state (capacity, cancellation, finalization) is not
  re-validated at accept time"** — it now is:
  `_validate_assignment_candidate(require_mutable=True, reject_past=True,
enforce_capacity=True)` is called before the seat moves
  (`scheduling_service.py:4363-4373`), and `require_mutable` rejects both
  `ShiftStatus.CANCELLED` and `shift.is_finalized`
  (`scheduling_service.py:2825-2829`) — read directly, not assumed from the
  parameter name.
- **"The approver-identity check is looser than the manual-review path"** —
  it is now a strict equality check: `str(swap_request.target_user_id) !=
str(responder_id)` rejects with "This offer was not made to you"
  (`scheduling_service.py:4305-4308`), before any other validation runs.

Two-way exchanges (the case SCH-5's own capacity/cancellation/finalization
concern is sharpest for, since a seat swap moves two rosters) are unaffected
by this class of gap at all: they can only be approved through
`review_swap_request`, which SCH-15 pass 1 already verified re-validates
fully and enforces separation of duties, and which this pass re-read in full
(`scheduling_service.py:4030-4261`) and confirms unchanged.

**Test coverage:** `tests/test_swap_offer_response.py` (17 tests, added in
the same commit range as the redesign) exercises exactly the two claims
above by name (`test_only_the_member_it_was_offered_to`,
`test_not_the_offerer_themselves`,
`test_an_ineligible_accepter_is_refused_and_the_seat_stays_put`,
`test_a_two_way_swap_still_goes_to_a_duty_officer`,
`test_the_acceptance_path_runs_that_validation` — a source-inspection test
confirming `_validate_assignment_candidate` is actually called, not just
present in the file) plus a
`test_approved_time_off_is_rechecked_not_only_at_candidate_selection` case
the original SCH-5 write-up didn't anticipate. All 17 confirmed passing
against current `main` (re-run this pass, not assumed from a prior report).

**Impact:** none — this is a documentation-accuracy correction, not a
behavior change. No code was modified.

**Fix:** updated the four documents above to mark SCH-5 (and the also-stale
"SCH-6 manual_hours has no bound" half of the combined `KNOWN_LIMITATIONS.md`
row — SCH-6's `hours` value was already `Field(gt=0, le=48)` at the schema
even at the time that row was written, per the app-review doc's own "Not a
finding" note) resolved, each citing the specific mechanism and test file
above rather than a bare "fixed" claim. No guard test added — the existing
17-test file already guards this class; adding a second one would duplicate
coverage rather than close a gap.

### No new findings

Every other checklist dimension came back clean on the files that actually
changed since pass 1: no new `.like()`/`.ilike()` call (still zero in
`scheduling_service.py`); no new CSV/export surface; no new JSON-column
mutation (the two changed service files don't touch `Shift.positions`/
`.activities`/`ShiftCall.responding_members`/`ShiftPattern.*`); no new
client-supplied FK id reaching a write path unvalidated (`apparatus_type_defaults_for_org`'s
only input is the caller's own `organization_id`); no new `SET NULL` FK
without `nullable=True` (no new columns at all this pass); no new
capacity/count-then-insert pattern requiring a Pitfall #27 lock.

## Guard tests added (pass 2)

None — SCH-11 is a documentation correction covered by pre-existing tests
(`tests/test_swap_offer_response.py`, confirmed passing, not newly written).

## Completion gate (pass 2)

| Check                                                 | Result                                                      |
| ----------------------------------------------------- | ----------------------------------------------------------- |
| `flake8 app/ tests/ alembic/`                         | ✅ 0 violations                                             |
| `black --check app/ tests/ alembic/`                  | ✅ 1323 files unchanged                                     |
| `isort --check-only app/ tests/ alembic/`             | ✅ clean (installed, not skipped)                           |
| `python3 scripts/validate_migrations.py --strict`     | ✅ single head, 389 revisions                               |
| `pytest tests/ -q -k "scheduling or shift or calcom"` | ✅ 681 passed, 1 skipped (pre-existing optional-dep skip)   |
| `pytest tests/` (full backend suite)                  | ✅ 9179 passed, 22 skipped (pre-existing Docker/no-MySQL)   |
| `tsc --noEmit`                                        | ✅ 0 errors                                                 |
| `eslint .`                                            | ✅ 0 errors, 10 warnings (pre-existing, same set as SEC-00) |
