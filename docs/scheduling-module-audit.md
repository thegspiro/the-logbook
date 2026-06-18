# Scheduling Module Audit

**Date:** 2026-06-18
**Branch:** `claude/determined-lamport-8qa2mp`
**Scope:** Backend (`endpoints/scheduling.py`, `scheduled.py`, `services/scheduling_service.py`, `services/scheduled_tasks.py`, `schemas/scheduling.py`, shift models in `models/training.py`) and Frontend (`modules/scheduling/**`, `pages/scheduling/**`, `types/scheduling.ts`).

This document records a read-only review covering: security issues, incomplete sections, outdated/unused code, and calculation correctness. Severity is the reviewer's estimate; **status** indicates whether the finding was independently verified against the source.

---

## 1. Security

### S1 — [HIGH] Swap request creation performs no ownership/org validation of supplied IDs (IDOR)
- **Where:** `services/scheduling_service.py:2384` (`create_swap_request`), endpoint `api/v1/endpoints/scheduling.py:1172`, schema `schemas/scheduling.py:534`
- **Status:** ✅ Verified.
- **Detail:** The endpoint takes `offering_shift_id`, `requesting_shift_id`, `target_user_id` from the request body and passes `model_dump()` straight into `ShiftSwapRequest(**swap_data)`. The service never confirms (a) `offering_shift_id` belongs to the caller's org, (b) the caller actually holds an assignment on it, or (c) `requesting_shift_id` / `target_user_id` belong to the same org. A user with `scheduling.swap` can create swap requests referencing shifts they are not on, or IDs from another organization.
- **Fix:** In `create_swap_request`, load `offering_shift_id` via `get_shift_by_id(offering_shift_id, organization_id)` and require an active `ShiftAssignment` for `requesting_user_id` on it; validate `requesting_shift_id` (if present) is in-org; validate `target_user_id` is a `User` in the org. Reject otherwise.

### S2 — [HIGH] Swap approval reassigns to an unvalidated shift id (cross-tenant data integrity)
- **Where:** `services/scheduling_service.py:2457` (`review_swap_request`), specifically line 2511.
- **Status:** ✅ Verified.
- **Detail:** The assignment lookups at 2484–2503 are correctly org-scoped, so foreign assignments can't be loaded directly. But line 2511 `req_assignment.shift_id = swap_request.requesting_shift_id` writes a user-supplied shift id (never validated to be in-org — see S1) onto the caller's own assignment, potentially moving a member onto a shift in another org. Fixing S1 (validating `requesting_shift_id` at creation) closes this; additionally re-validate the shift's org here before line 2511.

### S3 — [MEDIUM] `add_attendance` / `create_assignment` accept an arbitrary `user_id` not validated against the org
- **Where:** endpoint `scheduling.py:397` + `services/scheduling_service.py:943` (`add_attendance`); also `create_assignment` user_id (`scheduling_service.py:1697`) and pattern `assigned_members` (~1660). Schema `scheduling.py:127`.
- **Status:** ⚠️ Needs verification (reviewer-reported; logic plausible).
- **Detail:** The shift is confirmed in-org, but the supplied `user_id` is inserted without confirming that user is in the caller's organization. A `scheduling.manage` holder could credit hours/attendance to a user id from another org, which then surfaces in member-hours/compliance reports. Cross-tenant write, gated behind a manage permission.
- **Fix:** Validate the target `user_id` is a `User` with matching `organization_id` before insert.

### S4 — [MEDIUM] `update_assignment` allows direct mass-assignment of `assignment_status`, bypassing self-only confirm flow
- **Where:** endpoint `scheduling.py:1077`, service `scheduling_service.py:1868`, schema `ShiftAssignmentUpdate` `scheduling.py:488`.
- **Status:** ⚠️ Needs product-intent confirmation.
- **Detail:** `update_assignment` applies all fields except `PROTECTED_FIELDS` (`id, organization_id, created_at, updated_at, created_by`). `assignment_status` is therefore directly settable, so a `scheduling.assign` holder can force any member's assignment to `CONFIRMED`/`DECLINED`, bypassing the dedicated self-only `confirm_assignment` path. Confirm whether this is intended.

### S5 — [LOW] `confirm_assignment` org filter is optional
- **Where:** `services/scheduling_service.py:1947`.
- **Status:** ✅ Verified (no current exposure).
- **Detail:** `organization_id` defaults to `None` with a conditional org filter. The only caller (`scheduling.py:1125`) always passes it, so there's no live vulnerability, but the method would allow cross-org confirmation by `user_id` alone if ever called without it. Make the parameter required and always filter — defensive hardening.

### S6 — [LOW] `/shifts/open` date window is unbounded
- **Where:** endpoint `scheduling.py:222`.
- **Status:** ✅ Verified.
- **Detail:** `start_date`/`end_date` have no max span, unlike report endpoints which enforce `MAX_REPORT_DAYS=366`. Rows are bounded by `max_candidates=500` in the service, so impact is low, but a very wide window still scans a large range. Apply a similar guard for consistency.

### S7 — [NOTE] PII in scheduling responses — confirm SWR cache exclusion
- **Where:** `get_member_hours_report` (`scheduling.py:1491`), `get_availability_summary` (service ~2867) return member emails/names.
- **Status:** ⚠️ Needs verification against `frontend/src/utils/apiCache.ts` `UNCACHEABLE_PREFIXES`.
- **Detail:** Per HIPAA conventions, PII-bearing endpoints must be excluded from the in-memory SWR cache. Verify `/scheduling/reports/member-hours` and `/scheduling/availability` are excluded (or not cached).

### S8 — [NOTE] `scheduled.py` run-task is system-wide but gated only to `settings.manage`/`admin.access`
- **Where:** `api/v1/endpoints/scheduled.py:30`.
- **Status:** ✅ Verified (by design; flagged for awareness).
- **Detail:** `run-task` triggers tasks that iterate all organizations (`_for_each_org`). Any single-org admin with `settings.manage` can trigger global batch side effects (emails, writes) for every org. Tasks only touch each org's own data internally (no cross-tenant leak), but consider restricting to a platform-superadmin permission.

### Confirmed NOT vulnerable (checked)
- All `get_*_by_id` / `update_*` / `delete_*` filter by `organization_id`.
- `update_attendance` / `remove_attendance` join `Shift` and filter on `Shift.organization_id`.
- `cancel_swap_request` / `cancel_time_off` enforce ownership.
- Member self-service (check-in/out, signup, withdraw) derive `user_id` from `current_user`.
- `safe_error_detail` used consistently via `_safe_detail`; no raw/f-string SQL injection.
- Report endpoints validate and cap date ranges.

---

## 2. Calculations & Logic Correctness

Most calculation logic (recurrence math, DST/timezone handling, inclusive overlap comparisons, compliance period bounds, hours aggregation) was spot-checked and is **correct**. Confirmed issues are concentrated in a few spots.

### C1 — [IMPLEMENTED] Multi-platoon rotation now works end-to-end
- **Status:** ✅ Implemented (backend generation + UI + tests).
- **Model (grounded in fire-service standard):** A platoon pattern defines N platoons (A/B/C/D). Each platoon runs the **same base cycle offset by `i × cycle_length / num_platoons` days**, so exactly one platoon is on duty per day — matching how departments run 24/48, Kelly (9-day), 48/96, etc. Verified the offsets tile perfectly (24/48 → 0/1/2, Kelly → 0/3/6, 48/96 → 0/2/4: one platoon per day, full coverage).
- **Backend:** `generate_shifts_from_pattern` now builds per-platoon "tracks", creates a shift for each day a platoon is on, and assigns only that platoon's members (`assigned_members[].platoon`). Optional `schedule_config.platoon_offsets` can override the even spacing. Member IDs are batch-validated against the org before assignment. Patterns with no platoons configured keep the original single-cycle behavior (backward compatible).
- **Frontend:** New `PlatoonCrewEditor` in the pattern builder lets managers pick 2–4 platoons and assign each member (with a position) to one. Sent as `schedule_config.platoons` + `assigned_members` only once crews are assigned.
- **Tests:** `test_platoon_rotation_assigns_per_platoon` (3-platoon 24/48 → one shift/day, correct platoon staffed each day) and `test_platoon_without_platoons_assigns_all` (backward-compat).

<details><summary>Original finding (kept for history)</summary>

Multi-platoon rotation was not wired end-to-end
- **Where:** `services/scheduling_service.py` (`generate_shifts_from_pattern`, member loop ~1690); model `models/training.py:2582,2591`.
- **Status:** ✅ Verified — deeper than first reported.
- **Detail:** The model documents `assigned_members` as `[{"user_id","platoon","position"}]` and `schedule_config` as `{"platoons":["A","B","C"]}`, but on inspection the platoon dimension is **not implemented anywhere**:
  - The frontend pattern-creation UI (`PatternsTab.tsx`) never populates `assigned_members` and never sets `schedule_config.platoons`.
  - The backend never reads `member["platoon"]` or `schedule_config["platoons"]`.
  - There is **no data model for per-platoon offset** within the rotation cycle, so there is nothing describing which platoon is on duty on a given date — i.e. nothing to filter members against.
  - As coded, *if* `assigned_members` were populated with mixed platoons, all of them would be assigned to every generated shift. In practice no members are auto-assigned via the UI at all.
- **Why I did not "fix" it initially:** correctly implementing it is a feature requiring a design decision on the offset model + a member-assignment UI. After researching the fire-service standard (see implementation note above), this was implemented.

</details>

### C2 — [MEDIUM] Compliance auto-report never fires when `report_day_of_month` exceeds the month length
- **Where:** `services/scheduled_tasks.py:3390` (`run_compliance_auto_reports`).
- **Status:** ✅ Verified.
- **Detail:** `should_generate_monthly = freq in (...) and today.day == report_day`. If an org sets `report_day_of_month = 29/30/31`, the exact-match comparison is never true in February (or 30/31 in other short months), so that period's report is silently skipped. `today` is also UTC, so the day boundary is evaluated in UTC, not org-local time.
- **Fix:** Clamp the target day to month length: `effective_day = min(report_day, calendar.monthrange(today.year, today.month)[1])` and compare against that; consider evaluating in org timezone.

### C3 — [LOW] Auto-checkout writes a float into the Integer `duration_minutes` column
- **Where:** `services/scheduled_tasks.py:3967`; column `models/training.py:2342`.
- **Status:** ✅ Verified.
- **Detail:** `att.duration_minutes = max(round(delta / 60.0, 1), 0)` yields a one-decimal float (e.g. `483.5`) assigned to an `Integer` column. MySQL coerces it to int on insert, so the `.1` precision is meaningless and inconsistent with every other path (`int(delta.total_seconds() / 60)` at service lines 956/1004/1086/3773). Real-world impact is consistency, not corruption.
- **Fix:** `att.duration_minutes = max(int(delta / 60.0), 0)`.

### C4 — [LOW] Open-swap approval has no conflict/eligibility pre-check
- **Where:** `services/scheduling_service.py:2509`.
- **Status:** ✅ Verified.
- **Detail:** Approving an open swap reassigns the requester's assignment to `requesting_shift_id` with no check for an existing assignment on that shift (hits `UniqueConstraint(shift_id, user_id)` → raw IntegrityError, rolled back) or for time-off/double-booking conflicts (unlike the `get_unavailable_user_ids` logic used elsewhere). Functionally safe but produces a poor error.

### C5 — [LOW] Overnight-shift hours correctness depends on the frontend contract
- **Where:** schema validator `schemas/scheduling.py:58`; report `services/scheduling_service.py:2954` (`timestampdiff(MINUTE, start_time, end_time)`).
- **Status:** ✅ Verified (not a backend calc bug).
- **Detail:** The hours report is correct *only because* the schema rejects `end_time <= start_time`. A 19:00–07:00 overnight shift must be submitted with `end_time` on the next calendar day or it's rejected. Pattern generation handles this (adds a day, line 1630), but manual creation pushes the burden onto the client. Flagged as a contract risk.

### Verified correct (no action)
- WEEKLY weekday conversion `(weekday()+1)%7`; PLATOON cycle `days_since_start % cycle_length` and `position_in_cycle < days_on`; inclusive `while current <= end_date`.
- DST: local wall-clock times via `datetime(..., tzinfo=ZoneInfo(...)).astimezone(utc)`.
- Overlap/inclusive comparisons for time-off, availability, and conflict cancellation.
- `_compute_period_bounds` (QUARTERLY/BIANNUAL/ANNUAL/MONTHLY) traced correct incl. year-wrap and end-of-month.
- Coverage/staffing slot matching; compliance pro-rating & `count_leave_months`; hours aggregations (`finalize_shift`, summaries).

## 3. Incomplete Sections

No genuine incomplete sections found. Verified absent: no TODO/FIXME/XXX/HACK, no `NotImplementedError`, no `pass`-only stubs, no commented-out blocks, no "coming soon"/disabled UI. Backend `return []`/`return {}` are legitimate empty-result early returns. `console.warn` calls (`SchedulingNotificationsPanel.tsx`, `SchedulingPage.tsx:209`) are intentional non-critical logging. The `except: pass` blocks in `scheduled_tasks.py` are best-effort Redis lock cleanup (legitimate).

## 4. Outdated / Unused / Dead Code

### D1 — [Dead] Unused calendar-state slice in `schedulingStore.ts`
- **Where:** `frontend/src/modules/scheduling/store/schedulingStore.ts` — `shifts`(44), `shiftsLoading`(45), `shiftsError`(46), `setShifts`(54/154), `setShiftsLoading`(55/155), `setShiftsError`(56/156), and `summaryError`(41/136).
- **Status:** ✅ Verified zero consumers (components manage shifts via local `useState`).
- **Action:** Remove the calendar-state slice and `summaryError`.

### D2 — [Dead] Unused exports in global `frontend/src/types/scheduling.ts`
- `normalizeAssignment`(38) — zero usages; its docstring `{@link normalizeAssignmentStatus}`(26) references a symbol that doesn't exist (dangling).
- `ShiftTemplate`(85), `BasicApparatus`(118), `ShiftCompletionReport`(129) interfaces — never imported (the used ones come from `modules/scheduling/components/shiftTemplateTypes.ts` / `types/training.ts`).
- **Keep:** `Assignment`, `SwapRequest`, `TimeOffRequest`, `ShiftPattern`, re-exported API types.
- **Status:** ✅ Verified. **Action:** Remove the dead exports.

### D3 — [Dead] Unused Pydantic schemas in `backend/app/schemas/scheduling.py`
- `TemplateCategory`(330), `GenerateShiftsResponse`(468), `ShiftTimeOffUpdate`(595), `ShiftCoverageReport`(647), `CallVolumeReport`(657), `MemberHoursListResponse`(666) — never referenced (report endpoints return plain dicts).
- **Status:** ✅ Verified. **Action:** Remove (or wire endpoints to use them as `response_model` — the more useful fix). Will remove for now.

### D4 — [Duplicate] `SchedulingReportsPage.tsx` redefines report types locally, forcing `as unknown as` casts
- **Where:** `frontend/src/pages/SchedulingReportsPage.tsx` local interfaces (lines 36/46/53/61/68) duplicate the module types from `modules/scheduling/types/index.ts`, forcing `setAvailabilityData(data as unknown as AvailabilityRecord[])`(274).
- **Status:** ✅ Verified. **Action:** Replace local interfaces with the module types; remove double-casts. (Investigate shape diffs.)

### Low-confidence
- `TemplateType.COMBINED` (`equipmentCheck.ts:28`) shows zero frontend usage but is backend-driven — left in place.

## 5. Frontend Correctness & Pitfalls

### F1 — [MEDIUM] UTC-derived date range off-by-one (banned pattern)
- **Where:** `pages/scheduling/ShiftReportsTab.tsx:301-302` — `twoWeeksAgo.toISOString().split('T')[0]` / `today.toISOString().split('T')[0]` for `start_date`/`end_date`.
- **Status:** ✅ Verified. **Fix:** use `getTodayLocalDate(tz)` / `toLocalISODate()` with timezone.

### F2 — [MEDIUM] Bulk confirm/decline shows no error on total failure
- **Where:** `pages/scheduling/MyShiftsTab.tsx:267-295` — per-item `catch {}` swallows failures; success toast only fires `if (count > 0)`, so an all-fail batch gives zero feedback.
- **Status:** ✅ Verified. **Fix:** track failures, `toast.error` when `count === 0`.

### F3 — [MEDIUM] Empty-string `reason` sent to API (pitfall #1: `??`/raw vs `||`)
- **Where:** `MyShiftsTab.tsx:165` (swap `reason`) and `:196` (time-off `reason`) — optional fields sent raw, so `""` reaches the API.
- **Status:** ✅ Verified. **Fix:** `reason: ...reason || undefined`.

### F4 — [LOW/MED] Empty-string `user_id` when user is null
- **Where:** `pages/scheduling/OpenShiftsTab.tsx:86` — `user_id: user?.id ?? ''` sends `""` (required field) → malformed assignment/422.
- **Status:** ✅ Verified. **Fix:** early-return guard when `!user?.id`.

### F5 — [LOW] Empty-string `position` sent
- **Where:** `OpenShiftsTab.tsx:77,87` — `position: signupPosition` may send `""`. **Fix:** `signupPosition || undefined`.

### F6 — [LOW/MED] Equipment-check bar chart omits the "not checked" segment
- **Where:** `pages/scheduling/EquipmentCheckReportsPage.tsx:614-615` — heights use `pass/total` and `fail/total` where `total` includes `notCheckedCount`, so bars under-represent and don't match the numeric labels.
- **Status:** ✅ Verified. **Fix:** render a third segment for `notCheckedCount`.

### Cleared (explicitly not bugs)
- `MyShiftsTab.tsx:361-369` Avg Hours/Shift — trailing `|| 0` coerces `NaN`→`0`; renders fine.
- `ShiftSettingsPanel.tsx:272` spread of possibly-undefined object — valid JS/TS (`{...undefined}`→`{}`).
- Module axios (`modules/scheduling/services/api.ts`) uses shared `createApiClient()` — auth/CSRF correct.
- No banned `.toLocale*`/`date-fns`; no bare `toHaveBeenCalledWith()`.

---

## Questions / Decisions
- **C1 platoons:** Confirmed by owner as an intended feature → treated as a real bug; generation will filter members by the date's platoon.
- **Scope:** Owner chose to fix all confirmed findings.
- **S4** (`update_assignment` status mass-assignment) remains flagged for product intent — not fixed unless confirmed a bug.

---

## Fix Log

All confirmed findings were fixed on branch `claude/determined-lamport-8qa2mp`. Verified: frontend `tsc --noEmit` clean, ESLint clean on changed files, 28 affected frontend tests pass; backend `flake8` clean + `py_compile` OK (full backend pytest suite needs a live MySQL DB, unavailable in this environment).

**Backend — security**
- **S1/S2** — `create_swap_request` now validates `offering_shift_id` (in-org + caller is assigned), `requesting_shift_id` (in-org), and `target_user_id` (in-org) before persisting. Added `_user_in_org()` helper. (`scheduling_service.py`)
- **S3** — `add_attendance` and `create_assignment` now reject `user_id`s not in the caller's org. (`scheduling_service.py`)
- **S5** — `confirm_assignment` `organization_id` is now required and always filtered; two tests updated to pass it. (`scheduling_service.py`, `tests/test_scheduling.py`)
- **S6** — `/shifts/open` now rejects reversed ranges and caps the window at `MAX_OPEN_SHIFTS_DAYS` (366). (`endpoints/scheduling.py`)
- **S7** — No fix needed: `/scheduling/` is already in `UNCACHEABLE_PREFIXES` (`utils/apiCache.ts:50`). Resolved.
- **S4** — Not changed (needs product-intent confirmation). Still flagged.
- **S8** — By design; left documented.

**Backend — calculations**
- **C2** — Compliance auto-report day clamped to the month length (`min(report_day, days_in_month)`); evaluated per current month. (`scheduled_tasks.py`)
- **C3** — Auto-checkout `duration_minutes` now `int(...)` instead of `round(...,1)` float. (`scheduled_tasks.py`)
- **C4** — Open-swap approval pre-checks for an existing active assignment on the target shift, returning a clear error instead of a raw IntegrityError. (`scheduling_service.py`)
- **C1** — NOT fixed: requires design input (see below). Still open.
- **C5** — Left documented (frontend/contract concern, not a backend calc bug).

**Backend — dead code**
- **D3** — Removed unused schemas `TemplateCategory`, `GenerateShiftsResponse`, `ShiftTimeOffUpdate`, `ShiftCoverageReport`, `CallVolumeReport`, `MemberHoursListResponse`, and the now-orphaned `MemberHoursReport`. (`schemas/scheduling.py`)

**Frontend — correctness**
- **F1** — `ShiftReportsTab` date range now uses `toLocalDateString(twoWeeksAgo, tz)` / `getTodayLocalDate(tz)` instead of `toISOString().split('T')[0]`; `tz` added to effect deps.
- **F2** — Bulk confirm/decline now surface a `toast.error` with the failure count.
- **F3** — Swap and time-off `reason` now sent as `... || undefined`; widened `TimeOffCreate.reason` to `string | undefined` to satisfy `exactOptionalPropertyTypes`.
- **F4** — Open-shift admin-assign fallback guards on `user?.id` (no empty-string `user_id`).
- **F5** — Cleared: `signupPosition` defaults to `'firefighter'` and its select options are never empty, so `''` can't be sent. No change.
- **F6** — Equipment-check trend bars now render a third "Not checked" segment (+ legend), so proportions match the labels.

**Frontend — dead/duplicate code**
- **D1** — Removed the unused calendar-state slice (`shifts`/`shiftsLoading`/`shiftsError` + `setShifts*`) from `schedulingStore.ts` and its tests. **Kept** `summaryError` (populated by real error handling; removing it would reduce observability for no gain).
- **D2** — Removed dead exports `normalizeAssignment`, `ShiftTemplate`, `BasicApparatus`, `ShiftCompletionReport` from `types/scheduling.ts`; fixed the dangling `{@link normalizeAssignmentStatus}` doc reference.
- **D4** — Corrected: investigation showed the **module** report types were wrong, not the page's local ones. Backend `get_shift_coverage_report` / `get_call_volume_report` / `get_availability_summary` return **bare lists**, so the module `CoverageReport`/`CallVolumeReport`/`AvailabilityRecord` types and the `getCoverageReport`/`getCallVolumeReport` service signatures were inaccurate (hidden by `as unknown as`). Fixed the module types + service signatures to match the wire, updated the barrel, and removed the page's duplicate local interfaces and all `as unknown as` casts.

---

## C1 platoon rotation — IMPLEMENTED

Resolved (see the C1 section above). Implemented using the fire-service standard: each platoon runs the same cycle offset by `i × cycle_length / num_platoons` days so one platoon is on per day; members are assigned to platoons in the new `PlatoonCrewEditor` and staffed onto their platoon's generated shifts. Backward compatible (patterns without platoons keep the single-cycle behavior).

**Notes / possible follow-ups:**
- Editing platoon crews on an **existing** pattern: the editor is currently wired into the *create* flow. An equivalent edit flow on the pattern detail view could be added if you want to re-crew without recreating the pattern.
- Day/night multi-platoon rotations (e.g. one platoon on days, another on nights the same date) work because day and night resolve to different start times. If two platoons ever resolve to the *same* start time on the same date, the duplicate guard keeps one shift (a misconfiguration edge).
