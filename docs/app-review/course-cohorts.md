# Application Review — Course Cohorts & Syllabus

**Prefix:** `CC` · **Iteration:** A5 · **Reviewed:** 2026-08-05 (pass 1),
2026-08-08 (pass 2)

## Pass 2 (2026-08-08) — six-lens sweep

Re-verified the module rated cleanest in pass 1: XC-3 clean (sub-resource ops resolve
via `_get_cohort_class(id, org)`); generation bounded `MAX_GENERATED_CLASSES=200` at
four points; `cancel_event`/`update_event` carry org; CC-1 catalog-course JOIN
predicate holds; DST handled; no latent-500 in generation/preview/zero-class paths.
**1 fix.**

### CC-4 — MED — `add_ad_hoc_class` stored `category_id`/`requirement_id`/`phase_id` unvalidated (XC-1) — ✅ FIXED

The ad-hoc class path validated only `instructor_id` + `location_id` in-org, but
persisted `category_id`, `requirement_id`, and `phase_id` straight from client input
— and these flow into `_create_session_for_class` → `TrainingSessionCreate`. The
syllabus path's `_validate_references` validates exactly these three (Pitfall #14c),
so the ad-hoc path diverged: a same-permission officer could persist a cohort class
referencing another org's category/requirement/phase (dangling/mis-attributed FK).
**Fix:** extended the in-org validation loop to cover `category_id` (TrainingCategory)
and `requirement_id` (TrainingRequirement) via `assert_in_org`, and validated
`phase_id` through the `TrainingProgram` join (ProgramPhase has no org column) —
mirroring `_validate_references` exactly. 1 DB-free regression test (foreign category
→ `ValueError`, nothing persisted).

**Flagged (LOW, unchanged/new):** CC-2 (`location_id` backend-only, no UI — feature),
CC-3 (spring-forward `fold=0` NIT); new: the three catalog-course JOINs in
`list_cohorts`/`get_cohort_detail`/`list_member_cohorts` lack the CC-1 org predicate
(not live — the FK is org-validated at write and never repointed — but the CC-1
remediation should extend to them for consistency); and `reschedule_class`/
`cancel_class` commit before the endpoint's `cohort_id`-match check (within-org
cosmetic-integrity, no cross-tenant escalation).

---

**Backend:** `app/api/v1/endpoints/course_cohorts.py` (697 L, 14 endpoints),
`course_syllabus.py` (273 L, 6 endpoints),
`app/services/course_cohort_service.py` (1442 L),
`course_syllabus_service.py` (353 L),
`app/utils/scheduling_dates.py` (shared date resolver)
**Frontend:** `components/training/CohortWizard.tsx`,
`CourseSyllabusBuilder.tsx`, `pages/training/CohortsPage.tsx`,
`CohortDetailPage.tsx`
**Docs:** `docs/training/02-training.md` § *Multi-Class Courses & Cohorts*,
`docs/TRAINING_PROGRAMS.md`

---

## Scope

All 20 endpoints enumerated for gating; both services read for tenant
isolation, FK validation, generation bounds and date resolution; the shared
`resolve_class_datetimes` helper; and the frontend wizard's outgoing payload.

This is the **newest code in the rotation** (merged the day of this review), and
it is the cleanest module reviewed so far. It reads as though written against
the module-audit findings: the patterns those findings established — XC-1, XC-3,
generation bounds, org-scoped cross-module calls — are all present and correct
here rather than absent. The one substantive finding is a UI build-out gap, not
a defect.

## Verified good ✅

- **All 20 endpoints gated deliberately, with a real read/write split.** Writes
  require `training.manage`; three reads use `get_current_user` by design. The
  interesting one is `GET /cohorts/{id}`, which implements a **two-tier read**:
  officers (`training.manage` or `training.view_all`) see any cohort in their
  org, everyone else must be on the roster — and a non-member gets a 404, not a
  403, so cohort existence isn't disclosed.
- **XC-3 clean, verified mechanically.** All 16 public service methods take
  `organization_id` and use it. Sub-resource operations
  (`cancel_class`, `reschedule_class`) resolve their target through
  `_get_cohort_class(id, organization_id)` rather than a bare id — the exact
  pattern ELEC-2 and EC-4 got wrong.
- **XC-1 clean on every write path.** `create_cohort` validates `location_id`
  and `program_id` through the shared `assert_in_org` helper (the one CROSS-CUTTING
  recommended and most modules still don't use), resolves the course org-scoped,
  and `_add_members` filters candidate users by `organization_id`, reporting
  out-of-org ids as warnings rather than silently storing them.
  `course_syllabus_service.add_class` validates **both** `course_id` and the
  client-supplied `class_course_id` via org-scoped lookups.
- **Cross-module calls carry the org.** `cancel_class` → `EventService.cancel_event`
  passes `organization_id` rather than trusting the stored `event_id` — the
  failure mode that made EC-1 a cross-tenant write.
- **Generation is bounded — the SCH-3 lesson applied.**
  `MAX_GENERATED_CLASSES = 200` is enforced at four separate points (preview,
  create, ad-hoc add, and the running count), so a syllabus cannot be turned
  into an unbounded event-creation DoS.
- **DST is handled correctly**, which is unusual. `resolve_class_datetimes`
  computes the target *date* first (applying roll policy and blackout dates),
  then attaches the wall-clock time in the org's IANA zone and converts to UTC
  (`scheduling_dates.py:205`). A 19:00 class therefore stays 19:00 local across
  a spring-forward boundary. The naive alternative — adding `timedelta` to a UTC
  datetime — would silently shift every class after the transition by an hour.
- **The org timezone is resolved per cohort**, with a fallback, rather than
  assuming server time.
- **Frontend avoids Pitfall #1.** The wizard's outgoing payload uses
  `|| undefined` for every optional string (`code`, `default_start_time`,
  `program_id`) and explicit length checks for arrays. The `??` occurrences in
  these files are all *state initialization from a nullable source to a string*,
  which is the correct use. No banned date API (`toLocaleDateString` etc.), and
  `useTimezone()` is used in both the wizard and the detail page.
- **Well tested for new code:** 96 tests across `test_course_cohort.py`,
  `test_course_syllabus.py` and `test_scheduling_dates.py`, all passing without
  a database.
- **Documented before review** — a full section in the user-facing training
  guide, including the roll-policy warning behavior. No TODO/FIXME anywhere in
  the feature.

## Findings

### CC-1 — LOW — Catalog-course join had no org predicate — ✅ FIXED

**What:** both syllabus reads pair `CourseClass` with its catalog
`TrainingCourse` through an outer join keyed only on the FK:

```python
.outerjoin(TrainingCourse, CourseClass.class_course_id == TrainingCourse.id)
```

**Where:** `course_syllabus_service.list_classes`,
`course_cohort_service._syllabus`.

**Impact:** *defence in depth, not a live leak.* `add_class` validates
`class_course_id` in-org, so no foreign id can be stored through the API today.
But the joined row is projected into the response as `class_course_name` /
`class_course_code`, which is precisely the MM-1 shape — an eager-loaded FK with
no org filter on the join, where a single upstream gap becomes a cross-tenant
disclosure. The CROSS-CUTTING guidance is explicit that these are the XC-1
instances to prioritise.

**Fix:** moved the org predicate onto the **JOIN** condition rather than the
WHERE. That matters for an outer join: a row pointing out-of-org now yields
`NULL` for the course (name and code simply absent) instead of either
disappearing from the syllabus or rendering another department's catalog entry.
Behaviour is identical for all currently-storable data.

### CC-2 — MED — Room booking is implemented but unreachable from the UI — 🚩 FLAGGED

**What:** `location_id` is a fully-built backend capability with **no UI that
sets it**. `grep -rn "location_id" src/pages/training/ src/components/training/`
returns nothing.

What exists behind it:
- `CourseCohortCreate.location_id`, validated in-org via `assert_in_org`
  (`course_cohort_service.py:285`).
- `CourseClass.location_id` per syllabus row.
- A real double-booking check: `preview_schedule` calls
  `location_service.check_overlapping_events` and returns
  `"Location already booked: …"` as a per-class warning
  (`course_cohort_service.py:198–213`), and `create_training_session` runs the
  same check at generation.
- The service docstring advertises the behaviour: *"any warnings (a member who
  could not be enrolled, **a room clash the officer chose to accept**)"*.
- The type definitions declare `location_id` in five places.

**Impact:** because nothing ever sets a location, **the room-conflict warning
can never fire in practice**. A department scheduling a fifteen-class recruit
school into rooms that are already booked gets no warning, and the preview
screen's headline promise — see the clashes before fifteen events land — is only
half delivered. Nothing is broken; a built and tested capability is simply not
wired to a control. Same shape as the *"Finance: dues administration has no
UI"* entry already in KNOWN_LIMITATIONS.

**Why not fixed:** this is a frontend build-out (a location picker in the wizard
and in the syllabus builder, plus surfacing the returned warnings), not a
correction. It also needs a product call on whether the room is chosen
per-cohort, per-class, or both — the backend supports both, and the answer
changes the UI.

### CC-3 — NIT — Nonexistent local times resolve silently — OPEN

**What:** `datetime.combine(rolled, clock, tzinfo=tz)` on a local time inside a
DST spring-forward gap (e.g. 02:30 on the transition date) does not raise;
`zoneinfo` resolves it via `fold=0`.

**Impact:** negligible in practice — the gap is one hour, once a year, in the
small hours, and fire-department classes are not scheduled at 02:30. Recorded so
the next reader doesn't have to re-derive that it was considered.

## Duplication

None. The date logic that would otherwise be duplicated between this feature and
`scheduling_service` lives in the shared `app/utils/scheduling_dates.py` and is
independently tested — the right structure, and notably better than the eight
inline copies A3 found in `scheduled_tasks.py`.

## Dead code

None found. No TODO/FIXME markers; every endpoint has a frontend caller except
the location-related request fields covered by CC-2, which are unused input
fields rather than dead code.

## Documentation gaps

None requiring correction. The feature was documented before this review, in
the user-facing guide rather than only in code — including the roll-policy
warning behaviour and the cohort-vs-program distinction. Worth noting the
contrast: the *documented* room-clash warning (CC-2) is the one behaviour a
reader could not actually reach.

## Future development

1. **Wire up location selection (CC-2)** — the highest-value item here, because
   the backend work is already done and tested.
2. **Other API-only cohort fields:** `description`, `notes`, `requires_rsvp`,
   `auto_create_records`, and `default_duration_minutes` are all accepted by
   `CourseCohortCreate` and never sent by the wizard. Smaller than CC-2 (no
   downstream logic depends on them) but the same gap.
3. **No test asserts the two-tier read on `GET /cohorts/{id}`** — that a
   non-roster, non-officer member gets a 404. It is the module's only
   authorization branch and currently rests on manual reading.
4. **`regenerate_missing` has no dry run.** `preview_schedule` exists for
   creation; regeneration after a syllabus change applies directly.
5. **Cohort cancellation does not notify the roster.** `cancel_class` cancels
   the event (deliberately, so RSVPs see it) but `cancel_cohort` has no
   equivalent member-facing notice.

## Completion gate

| Check | Result |
|-------|--------|
| `tsc --noEmit` | ✅ 0 errors (no frontend change) |
| `flake8 app/ tests/` | ✅ 0 violations |
| `black --check` | ✅ 502 files unchanged |
| `eslint` | ✅ clean |
| backend tests | ✅ **2508 passed, 0 failed**; the 57 cohort/syllabus tests pass against the changed joins. 648 errors, all `db_session` fixture failures against the sandbox's missing MySQL. |
</content>
