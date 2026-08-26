# Security Review 16 — Events & Requests

**Prefix:** `EV` · **Iteration:** 16 · **Reviewed:** 2026-08-26 · **PR:** [#1848](https://github.com/thegspiro/the-logbook/pull/1848)

**Backend:** `api/v1/endpoints/events.py` (3,313 L, 55 routes),
`api/v1/endpoints/event_requests.py` (1,838 L, 23 routes — includes the
public outreach event-request intake pipeline),
`services/event_service.py` (4,019 L),
`services/event_request_service.py` (1,105 L — new since the last full
read, extracted from `event_requests.py`)
**Frontend:** `modules/events`
**Migrations:** none this iteration (no schema change)

---

## Scope

Module-audit iteration 17 plus four app-review Tier B passes
(2026-08-06 through 2026-08-09) already covered this module in depth — this
is its first pass through the security-review rotation. All three backend
files have grown since that last full read: `events.py` 2,931 → 3,313 L
(53 → 55 routes), `event_requests.py` 1,658 → 1,838 L (18 → 23 routes),
`event_service.py` 3,097 → 4,019 L (+922, ~30%). `event_request_service.py`
is new — the prior notification/pipeline logic was extracted out of
`event_requests.py`'s endpoint file into its own service module.

**Read in full, not sampled:** all three backend files above, plus the new
`event_request_service.py`. Diffed against the oldest reachable git ancestor
for each file to separate genuinely-new surface from refactors, rather than
guessing from line-count growth alone.

**Not read line-by-line:** the frontend module — checked only the
cache-exclusion checklist item (already correct; see Verified good).

## Route inventory

**`events.py` — 55/55 routes authenticated except one, unchanged from the
prior audit:** `GET /public-calendar` has no auth dependency, by design
(public-facing calendar; excludes drafts/cancelled; present since before the
last full read). All 54 other routes carry `get_current_user` (member-level:
list/get/RSVP/self-check-in/QR-data/attachment list-download/visible-event-types)
or `require_permission("events.manage")` / `"events.reopen_attendance"` /
an OR of `"analytics.view","events.manage"`.

**`event_requests.py` — 23/23 routes.** Three are the known-public,
already-audited intake trio (`POST /public` + `require_captcha`,
`GET /status/{token}`, `POST /status/{token}/cancel`). A fourth,
**`GET /types/labels`, is also unauthenticated** and was not explicitly
named alongside the trio in the prior audits' route-by-route lists — it
predates the last full read (not new surface) and is low-risk: it returns
only outreach-type value/label pairs (no PII, no write) to populate the
public intake form's dropdown before an org is even chosen, functionally
part of the same public form flow the trio already serves. Recording it
explicitly here so the public-surface inventory is complete rather than
relying on the trio being read as exhaustive. All 19 remaining routes carry
`get_current_user` (self-scoped: `GET /outreach-roles`) or
`require_permission("events.manage")`.

No new unauthenticated route was added to either file since the last audit.

## Verified good ✅

- **EV-1 through EV-10, EV2-1, EV2-2 all re-verified still fixed** — no
  regressions. Specifically re-checked: `location_id` org-validation on
  `create_event`/`update_event`/`update_future_events`/`create_recurring_event`
  and template `default_location_id` (EV-1/EV-8/EV2-2); `contact_name`
  escaping in outbound notification HTML, still present after the
  extraction into `event_request_service.py` (EV-2); `rsvp-series` anchor
  org-scoping (EV-3); RSVP blocked on draft/past events (EV-6);
  `send_template_email`/`render_request_template` None-safety (EV-7);
  `end_event` audit-log signature (EV-9); draft events excluded from public
  feeds (EV-10); event/RSVP enum `field_validator`s on all nine request
  schemas (EV2-1); `schedule_request`'s `event_location_id` validated
  in-org and `_get_location_name` org-scoped (EV2-2).
- **Every by-id lookup across both endpoint files and both services filters
  `organization_id`** — event, RSVP, attachment, series/recurring, external
  attendee, template, and event-request lookups all confirmed. One
  stylistic exception: `get_check_in_monitoring_stats` fetches the `Event`
  by id alone then compares `organization_id` in Python rather than
  filtering in the query — not a vulnerability (both sides are plain
  strings at runtime, so the comparison is correct and fails closed), just
  inconsistent with the query-filter idiom used everywhere else in the
  file.
- **RSVP capacity locking is correct on both halves of Pitfall #27** — the
  parent event row is locked (`for_update=True`) AND the seat-count query
  itself is a locking read (`select(func.count(EventRSVP.id))...with_for_update()`),
  confirmed at both `create_or_update_rsvp` and `promote_from_waitlist`.
  This is the exact class of bug CLAUDE.md's own pitfall doc warns a
  parent-only lock misses under REPEATABLE READ — and this file is the one
  where it was already found and fixed (commit message: "the lock was not
  the whole fix"), so this iteration verified the fix is intact rather than
  rediscovering the class.
- **Series/recurrence generation remains capped at 365** occurrences
  (`_generate_recurrence_dates` + an independent check in
  `create_recurring_event`) — no unbounded generation path found.
- **No SQL injection / no LIKE surface** in `event_service.py` — zero
  `.like()`/`.ilike()` calls.
- **JSON-column mutation discipline holds** — every write to
  `custom_fields`/`allowed_rsvp_statuses`/`reminder_schedule`/`attachments`
  either deep-copies first or reassigns a wholly new object; no in-place
  mutation of a live mapped JSON attribute found (Pitfall #12).
- **Update payloads correctly distinguish omitted from explicit-null** — all
  update paths use `model_dump(exclude_unset=True)` upstream and iterate
  only present keys (Pitfall #1 mirror-image).
- **The new attendance-finalization lock system** (`finalize_event_attendance`,
  `reopen_event_attendance` behind its own dedicated `events.reopen_attendance`
  permission — deliberately separate from `events.manage` so the person who
  finalized can't unilaterally reopen — and the lock check wired into every
  attendance-affecting write) carries org-scoping correctly on every path,
  including the series-wide bulk paths (`delete_event_series`, `cancel_series`,
  `update_future_events`), which were specifically hardened to refuse the
  whole batch if any occurrence is locked.
- **The new staffing/volunteer-call surface** in `event_request_service.py`
  (`_load_request_for_staffing` and friends) locks its parent row
  (`with_for_update()`) for the same reason RSVP capacity does — two
  coordinators opening the same signup sheet — and is org-scoped throughout.
  `apply_default_assignee` now validates the configured default assignee is
  still in-org before assigning (closes a latent gap that predates this
  iteration, not introduced by it).
- **`get_user_name`'s by-id `User` lookup has no org filter of its own**, but
  every value that reaches it (`assigned_to`, `performed_by`, the caller's
  own id) is already org-validated at the point it was written or is
  trivially the caller's own id — it resolves through an already org-scoped
  parent, satisfying checklist item XC-3's alternative clause. Traced all 5
  call sites to confirm none passes a client-supplied, not-yet-validated id.
  Not a finding.
- **`/events/` and `/event-requests` PII is correctly excluded from the
  frontend response cache** — `/event-requests` is a full prefix exclusion;
  `/events`'s sensitive sub-resources (`/rsvps`, `/rsvp-history`,
  `/external-attendees`, `/check-in-monitoring`, `/missed-mandatory`) are
  covered via `UNCACHEABLE_SUBSTRINGS`/`UNCACHEABLE_PREFIXES`, consistent
  with how other modules split cacheable list/detail from sensitive
  sub-resources. `GET /{event_id}/qr-check-in-data` (new since the last
  audit) returns only event metadata (name, times, validity window) — no
  member PII, no credential — so it doesn't need its own entry.
- **No CSV export in this module** — the one CSV-adjacent code path,
  `import_events_from_csv`/`parse_csv_file`, is an _import_ (bulk event
  creation from an uploaded file), not an export, so `SafeCsvWriter`
  doesn't apply. It's permission-gated (`events.manage`), size-capped
  (5 MB), and writes only server-derived, org-stamped `Event` rows — no
  client-supplied FK ids in the imported columns (`location` is free text,
  not `location_id`).

## Findings

### EV-11 — LOW (correction, XC-1) — `create_recurring_event` stored a client-supplied `template_id` unvalidated — ✅ FIXED

**What:** `RecurringEventCreate.template_id` is a client-supplied
`Optional[UUID]` that flowed into `create_recurring_event`'s `event_data`
dict and onto every generated occurrence with no in-org check — unlike
`location_id`, validated two lines above it in the same function.

**Where:** `app/services/event_service.py` — `create_recurring_event`
(was line ~3343, immediately after the existing `location_id` check).

**Correction during this iteration's own drafting:** the first version of
this fix also added the identical check to `create_event` (the plain,
non-recurring path), reasoning from a misread of `app/schemas/event.py` —
line 396's `template_id` field belongs to `EventResponse`, not `EventCreate`.
**`EventCreate` has no `template_id` field at all**, so `event_data.
template_id` in `create_event` raised `AttributeError` on every call,
failing all 16 tests in `test_event_lifecycle.py`. Caught by running the
full test suite before considering the fix complete, not by external
review. Reverted that half; only `create_recurring_event` needed the guard,
since it's the only path whose input schema (`RecurringEventCreate`) has a
`template_id` field to begin with.

**Failure scenario:** a manager creates a recurring event series naming
another org's `template_id`. Today this persists a dangling foreign key on
every occurrence with no read-back leak — `EventResponse.template_id`
echoes only the raw UUID, no relationship is eager-loaded/name-projected
the way `location_obj` was in the actual EV-1/EV-8 leak, and any subsequent
dereference (`GET /templates/{id}`) is itself org-scoped and 404s on a
foreign id. So this is not a live disclosure. It is the same XC-1 pattern
the `location_id` fix exists to prevent, though, and a future feature that
resolves `event.template_id` without re-checking org (e.g. "apply this
event's template settings") would reopen exactly the read-leak class
EV-1/EV-8 closed for locations.

**Impact:** LOW. No current exploit path; closes a latent gap defensively,
matching the discipline already applied to every other client-supplied FK
in this file.

**Fix:** `create_recurring_event` now validates `template_id` via the
existing org-scoped `get_template()` before generating occurrences,
mirroring the `location_id` check immediately above it. Guard test:
`test_event_recurrence.py::TestCreateRecurringEventTemplateValidation::test_foreign_template_rejected`.

## Schema & migration notes

No schema changes this iteration. No `SET NULL` nullability issues found in
either file's models.

## Guard tests added

- `test_event_recurrence.py::TestCreateRecurringEventTemplateValidation` (1
  test) — EV-11: a foreign `template_id` is rejected before any occurrence
  is generated.

## Completion gate

| Check                                                     | Result                                                           |
| --------------------------------------------------------- | ---------------------------------------------------------------- |
| `flake8 app/ tests/ alembic/` (changed files)             | ✅ 0 violations                                                  |
| `black --check app/ tests/ alembic/` (changed files)      | ✅ clean                                                         |
| `isort --check-only app/ tests/ alembic/` (changed files) | ✅ clean                                                         |
| `python3 scripts/validate_migrations.py --strict`         | ✅ single head                                                   |
| `pytest tests/ -k "event"`                                | ✅ 548 passed, 1 skipped (pre-existing optional-dependency skip) |
| `pytest tests/` (full backend suite)                      | ✅ 8557 passed, 22 skipped (pre-existing Docker/no-MySQL skips)  |
| `tsc --noEmit` / `eslint .`                               | n/a — no frontend file changed this iteration                    |
