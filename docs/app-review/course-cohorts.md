# Application Review — Course Cohorts & Syllabus

**Prefix:** `CC` · **Iteration:** A5 · **Reviewed:** 2026-08-05 (pass 1),
2026-08-08 (pass 2), 2026-10-03 (pass 3)

> **Finding ids continue at CC-5.** CC-1…CC-4 are taken by passes 1–2 below.
> Note the `CC-` prefix is shared with other review tracks — the same collision
> recorded against `CRON-`, `SF-` and `AUTH-` elsewhere.

## Pass 3 (2026-10-03) — the shift endpoint

`POST /cohorts/{id}/shift` and `shift_remaining` did not exist at pass 2: the
endpoint count went 14 → 15 and the service 1442 → 1544 lines. The rest of the
module was re-verified rather than re-derived. **2 fixes, 1 flagged.**

Both fixes are in the newest code, and both are the same shape as CC-4 — a path
added later that diverges from the convention established beside it in the same
file. Worth noting for its own sake: the two defects are each invisible to the
tests that covered the endpoint, by construction.

### CC-5 — MED — A shift across a daylight-saving transition moved every class an hour in local time — ✅ FIXED

**What:** `shift_remaining` added the delta to the stored **UTC instant**:

```python
cohort_class.scheduled_start = cohort_class.scheduled_start + delta
```

**Where:** `backend/app/services/course_cohort_service.py:952` (pre-fix).

**Impact:** classes are stored UTC (`training.py:1060`, `DateTime(timezone=True)`)
and displayed local, so adding exact elapsed hours holds the UTC clock still and
moves the wall clock whenever the offset changes underneath it. Measured for
`America/New_York`:

|                                | local                        | UTC               |
| ------------------------------ | ---------------------------- | ----------------- |
| 19:00 class, 29 Oct 2026 (EDT) | `2026-10-29 19:00`           | `23:00Z`          |
| after `days=7`, as written     | **`2026-11-05 18:00`** (EST) | `23:00Z`          |
| after `days=7`, intended       | `2026-11-05 19:00`           | `00:00Z` next day |

A recruit school delayed a week over the November change has every remaining
class an hour earlier than the officer set and than members were told, and
`_sync_event` pushes the wrong time onto the linked event, so the RSVP and
check-in window move with it. March shifts it the other way.

**Reachable from the UI, not just the API.** `CohortDetailPage.tsx:134` calls
`courseCohortService.shiftClasses` from a days input, so this is the ordinary
path an officer takes to push a cohort back after a snow day — not an
integrator-only surface.

This is precisely the failure pass 1 singled out as _avoided_ — it praised
`resolve_class_datetimes` for computing the local date first and called the
naive alternative out by name: _"adding `timedelta` to a UTC datetime would
silently shift every class after the transition by an hour."_ The newer endpoint
reintroduced it, 40 lines from a `_get_org_timezone` helper it did not call.

**Fix:** `_shift_local_days` converts to the organization's zone, adds the delta
there (arithmetic on an aware datetime moves the naive fields and leaves the zone
alone, so the wall clock is preserved), and converts back — the same local-first
order `resolve_class_datetimes` uses. It also normalizes the input: a value read
back from the driver is naive-and-already-UTC while one built in Python is aware,
and both reach this function.

**Guarded:** `test_a_shift_across_the_dst_change_keeps_the_local_class_time`
asserts the wall clock and additionally asserts the offset really changed, so it
cannot pass against the broken arithmetic. Mutation-verified: restoring
`value + delta` fails it with `'2026-11-05 18:00' == '2026-11-05 19:00'`.

**Why two passes missed it:** the endpoint postdates them. But the existing
tests would not have caught it either — they shift 1 Oct → 8 Oct, which crosses
no transition, and assert `.date()` only, never the hour.

### CC-6 — MED — An attendance refusal part-way down the list left the cohort half-shifted and committed — ✅ FIXED

**What:** the loop mutated each class and then called `_sync_event`, which goes
through `EventService.update_event` — and that **commits on the same session**
(`event_service.py:946`). `update_event` also raises the attendance lock for any
change to `start_datetime`/`end_datetime` on a finalized event
(`event_service.py:875-880`, `ATTENDANCE_SENSITIVE_UPDATE_FIELDS`).

**Where:** `course_cohort_service.py:951-956` (pre-fix); the endpoint's
`attendance_lock_http_error` mapping at `course_cohorts.py:477`.

**Impact:** the classes are processed `order_by(sequence)`, so the first
finalized class aborts the run — after every earlier class has already been
moved _and committed_ by the previous iteration's `update_event`. The officer
gets a 409 whose text says the change was refused, and the schedule is in fact
half-moved, with no indication of how far it got (`moved` is never returned on
the error path). It is reachable in ordinary use rather than exotically: the
lock bites on classes that already happened, and `from_sequence` exists
specifically to reach back into those (CC-7).

**Fix:** `_assert_shiftable` resolves the batch's events in one org-scoped query
and raises the same sentinel refusal before anything is mutated, so the
operation either moves every class or none. The error is built from a count and
fixed text only, per `attendance_locked_error`'s contract that the sentence
reaches the client verbatim.

Honest bound on the fix: it closes the refusal path, which is the one that
triggers in practice. It does not make the loop atomic in general — that would
need `update_event` not to commit, and it is shared by many callers — so a
failure from another cause can still leave a partial shift. Recorded rather
than papered over.

**Guarded:** `test_a_finalized_class_refuses_the_shift_before_moving_anything`
asserts the raise, that `update_event` is never awaited, that the first class's
datetime is untouched, and that nothing committed. Mutation-verified by removing
the pre-check call.

### CC-7 — LOW — `from_sequence` silently includes classes that already happened — 🚩 FLAGGED

**What:** the sequence bound **replaces** the future-only bound rather than
narrowing it:

```python
if data.from_sequence:
    query = query.where(CourseCohortClass.sequence >= data.from_sequence)
else:
    query = query.where(CourseCohortClass.scheduled_start > now)
```

**Where:** `course_cohort_service.py:985-988`.

**API-only today.** The shift control in `CohortDetailPage.tsx:134` sends
`days` and nothing else, so no UI reaches this branch — it is available to any
`training.manage` holder calling the endpoint directly, and to integrators.
That lowers how often it can bite without settling whether the behaviour is
wanted, which is why it is a flag rather than a fix.

**Impact:** the method's own docstring claimed _"Only future, non-cancelled
classes move. Classes that already happened keep their dates."_ That is true of
the `else` branch and false of the other one, so `from_sequence=1` moves the
whole cohort including delivered classes. With CC-6 fixed, any such class whose
attendance is **finalized** now refuses the batch; one that happened but was
never finalized still moves silently.

**Why flagged, not fixed:** whether that is wrong is a product call, and the two
readings lead to opposite changes. Re-shifting "from class 5 onward" after a
syllabus correction, including a class that slipped past its date unfinalized,
is a plausible intended use — in which case the filter is right. If an officer
should never be able to move a delivered class, the fix is to intersect the two
bounds, which narrows existing behaviour. I corrected the **docstring** to
describe what the code does (a doc fix, in scope) and left the behaviour alone.

**Also re-verified — and pass 2's count is now wrong.** Pass 2 flagged _three_
catalog-course joins as lacking the CC-1 org predicate. Checked individually,
it is **two**:

| Site                            | Join predicate                              | State               |
| ------------------------------- | ------------------------------------------- | ------------------- |
| `list_cohorts` (`:1415`)        | FK only                                     | still open          |
| `_syllabus` / detail (`:1499`)  | FK **and** `TrainingCourse.organization_id` | closed since pass 2 |
| `list_member_cohorts` (`:1601`) | FK only                                     | still open          |

Unchanged in substance: not a live leak, for the reason pass 2 gave — the FK is
org-validated at write and never repointed — and still the CC-1 remediation not
carried across for consistency. CC-2 (location UI) and CC-3 (`fold=0` NIT) are
unchanged.

### Pass 3 completion gate

| Check                            | Result                                                                                                                                                                                                                                                                                                                                                          |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run typecheck`              | ✅ 0 errors (no frontend change)                                                                                                                                                                                                                                                                                                                                |
| `flake8 app/ tests/`             | ✅ 0 violations                                                                                                                                                                                                                                                                                                                                                 |
| `black --check app/ tests/`      | ✅ 1342 files unchanged                                                                                                                                                                                                                                                                                                                                         |
| `isort --check-only app/ tests/` | ✅ clean                                                                                                                                                                                                                                                                                                                                                        |
| `npm run lint`                   | ✅ 0 errors                                                                                                                                                                                                                                                                                                                                                     |
| Docs link check                  | ✅ 419 files, 0 broken                                                                                                                                                                                                                                                                                                                                          |
| Dependent backend tests          | ✅ **196 passed** — every test file importing `CourseCohortService` or naming a cohort: `test_course_cohort`, `test_course_syllabus`, `test_scheduling_dates`, `test_attendance_lock_reaches_client`, `test_course_cohort_class_mutation_scoping`, `test_pipeline_yearly_trends`, `test_training_extended_null_handling`, `test_training_session_course_lookup` |
| Whole backend suite              | ⚠️ **not completed here** — see below                                                                                                                                                                                                                                                                                                                           |

**The whole-suite run is an environment limitation this pass could not clear,
recorded rather than glossed.** The suite now collects **15,709** tests, up from
12,325 on 2026-09-10. It no longer finishes inside the session's 30-minute
background ceiling, and splitting it into thirds did not help — the first third
alone exceeded ten minutes, so the slowdown is per-test rather than a matter of
total count, and points at DB-backed tests added over the last three weeks
rather than at anything in this diff. Growth in test _count_ alone would predict
roughly six minutes.

What was run instead is the set that can actually fail from this change: the
changed service has exactly two importers in `app/` (`course_cohorts.py`,
`course_syllabus_service.py`) and the eight test files above cover them. CI runs
the full suite on the branch, so the whole-suite result is still gated before
merge — it is simply not a number this pass can report.

---

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
**Docs:** `docs/training/02-training.md` § _Multi-Class Courses & Cohorts_,
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
  computes the target _date_ first (applying roll policy and blackout dates),
  then attaches the wall-clock time in the org's IANA zone and converts to UTC
  (`scheduling_dates.py:205`). A 19:00 class therefore stays 19:00 local across
  a spring-forward boundary. The naive alternative — adding `timedelta` to a UTC
  datetime — would silently shift every class after the transition by an hour.
- **The org timezone is resolved per cohort**, with a fallback, rather than
  assuming server time.
- **Frontend avoids Pitfall #1.** The wizard's outgoing payload uses
  `|| undefined` for every optional string (`code`, `default_start_time`,
  `program_id`) and explicit length checks for arrays. The `??` occurrences in
  these files are all _state initialization from a nullable source to a string_,
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

**Impact:** _defence in depth, not a live leak._ `add_class` validates
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
- The service docstring advertises the behaviour: _"any warnings (a member who
  could not be enrolled, **a room clash the officer chose to accept**)"_.
- The type definitions declare `location_id` in five places.

**Impact:** because nothing ever sets a location, **the room-conflict warning
can never fire in practice**. A department scheduling a fifteen-class recruit
school into rooms that are already booked gets no warning, and the preview
screen's headline promise — see the clashes before fifteen events land — is only
half delivered. Nothing is broken; a built and tested capability is simply not
wired to a control. Same shape as the _"Finance: dues administration has no
UI"_ entry already in KNOWN_LIMITATIONS.

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
contrast: the _documented_ room-clash warning (CC-2) is the one behaviour a
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

| Check                | Result                                                                                                                                                                        |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tsc --noEmit`       | ✅ 0 errors (no frontend change)                                                                                                                                              |
| `flake8 app/ tests/` | ✅ 0 violations                                                                                                                                                               |
| `black --check`      | ✅ 502 files unchanged                                                                                                                                                        |
| `eslint`             | ✅ clean                                                                                                                                                                      |
| backend tests        | ✅ **2508 passed, 0 failed**; the 57 cohort/syllabus tests pass against the changed joins. 648 errors, all `db_session` fixture failures against the sandbox's missing MySQL. |

</content>
