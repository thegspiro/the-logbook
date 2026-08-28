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

## Pass 2 (2026-08-28)

**Scope corrected this pass, verified clean, no code changes.** Full-domain
diff since pass 1's merge (`c68a9bef`, PR #1848 — single merge, no
Codex-follow-up commit to re-scope against).

### Backend diff

`git diff --stat c68a9bef..origin/main` for the four declared files plus
`app/models/event.py`, `app/models/event_request.py`,
`app/schemas/event.py`, `app/schemas/event_request.py`: only
`event_service.py` changed (+17/-6), and it is byte-identical to pass 1
everywhere else. The change is `3024a941`
("security(admin-hours): fix cross-org compliance leak, clock-in race,
edit-guard parity") — feature 21's own fix, not this rotation's — which
added an `organization_id` parameter to `AdminHoursService.
delete_event_attendance_entries` (closing a cross-org gap in _that_
service) and threaded it through this file's three call sites
(`cancel_event`, `delete_event`, `remove_attendee`) and the shared
`_revoke_event_attendance_credit` helper, plus an org filter on that
helper's own RSVP-id query. Read all three call sites directly rather than
trusting the commit message: at every one, `organization_id` is the
already-validated caller org used moments earlier to org-scope the parent
`Event` fetch (`cancel_event`:759/767, `delete_event`:951/956,
`remove_attendee`:1717/1728), so the newly-threaded value is correct, not
attacker-influenceable. Verified good, not a finding for this feature.

**Also checked, per the EC-14/SCH-15 lesson (grep beyond the declared file
list for other files referencing this feature's models that changed since
pass 1):** `dashboard.py` (`get_community_engagement`'s external-attendee
count, correctly org-scoped after the fix — unrelated notifications-feature
change), `admin_hub_service.py` (`_events_attendance_rate` gained a
defense-in-depth `Event.organization_id` filter alongside the existing
`EventRSVP.organization_id` one — LOC2-32-1's own fix), `meetings_service.py`
(`create_meeting_for_event` gained the Pitfall #27 second-lock the rotation's
own meetings pass added — the event fetch was already locked; the
meeting-existence check is now a locking read too), `scheduled_tasks.py` (a
timezone-naive-vs-aware fix in the recurring-event-generation cron task,
unrelated to auth/tenancy), `membership_pipeline.py` and
`course_cohort_service.py` (import-only changes, no logic touching Event
data). All five are read-only consumers of `Event`/`EventRSVP`, already
fixed and tested by their own rotation feature; none is a write path this
feature owns, and none introduces a new gap in it.

**Migrations:** `git diff --stat` against `backend/alembic/versions/` (not
scoped to source files this time — the exact gap Codex found in SCH-15
pass 2) shows 18 new files since `c68a9bef`; grepped each for `event` by
content, not filename, and confirmed none touches `events`, `event_requests`,
`event_rsvps`, or any other table this feature owns (`d4e5f6a7b8c9` is
message recipients; `e2c8f5a71d40` rewrites `shifts.positions`/
`shift_templates.positions` and only mentions "event screens" in an
unrelated code comment).

### Frontend scope correction (real gap, found before Codex could catch it)

Pass 1 scoped its frontend check to `modules/events/` and read only the
cache-exclusion checklist item there. **`modules/events/` is a two-file
barrel** (`index.ts` + `routes.tsx`, route registration only) — the actual
events frontend is ~20,650 lines across 54 files living in `pages/Event*.tsx`
(14 files), `components/EventForm.tsx`/`EventTemplateForm.tsx`/
`EventTypeBadge.tsx`/`components/event-detail/` (12 files)/`components/events/`
(2 files), `services/eventServices.ts`, `types/event.ts`,
`utils/eventHelpers.ts`, and `hooks/useEventNotifications.ts` — none of which
live under `modules/events/` and none of which pass 1's doc named. This is
the exact same class of gap SCH-15 pass 2 found for `pages/scheduling/` and
EC-14 pass 2 found for its equipment-check pages, so this pass swept the
directory tree explicitly (`find frontend/src -iname "*event*"`) rather than
trusting the module barrel to be the whole surface.

Of the 54 real files, only two changed since pass 1 (confirmed via
`git diff --stat`, not assumed): `EventForm.tsx` (+13/-2, a pure display
tweak shortening a facility room's label when the org has only one facility
— no data/permission change) and `eventServices.ts` (+87/-8, entirely
inventory-feature type additions/renames from INV-11 that happen to live in
this shared file — `RequestTypeLiteral`, `ReorderTransition`,
`DistributeItemsRequest`, etc. — nothing events-related). Both read in full;
neither touches auth, org-scoping, or user-controlled HTML.

The remaining 52 unchanged files were swept with the same targeted greps
EC-14/SCH-15 used for their own large, unchanged frontend surfaces —
`window.confirm`/`alert`/`prompt`, `dangerouslySetInnerHTML`, banned
`.toLocaleString`/`.toLocaleDateString`/`.toLocaleTimeString`, a `date-fns`
import, and a direct `fetch(` call — all clean (zero hits across all five
patterns over all 54 files). Noted as partial-scope, not assumed fully
read line-by-line: this closes the _discovery_ gap (the surface is now
correctly identified and its unchanged files swept), but a first full
line-by-line read of the 52 untouched files is still owed to a future pass,
the same disposition SCH-15 gave its own `pages/scheduling/` sweep.

### Re-verification (not re-derivation) of pass 1's key mechanisms

Every "Verified good" claim in pass 1 with a specific mechanism was
re-checked by reading the current code at its cited (or renumbered) line,
not by re-citing the doc:

- **Route/permission enumeration re-run from scratch** (AST walk of
  `events.py`, not a diff): 55/55 routes carry a recognized auth dependency
  except `GET /public-calendar` (unauthenticated by design, unchanged).
  `event_requests.py`: 23/23 routes, same public trio
  (`POST /public` + `require_captcha`, `GET /status/{token}`,
  `POST /status/{token}/cancel`) plus `GET /types/labels`, matching pass 1
  exactly. **One route pass 1's permission summary omitted:**
  `GET /{event_id}/folder` is gated `require_permission("events.view")`, a
  distinct tier pass 1's prose ("get_current_user ... or
  require_permission('events.manage') / 'events.reopen_attendance' / an OR
  of 'analytics.view','events.manage'") never named. Not a defect —
  `events.view` is a baseline grant every member holds
  (`core/permissions.py` `DEFAULT_POSITIONS["member"]`), so this route is
  _more_ restrictive than the bare-authentication routes it sits beside, and
  it returns only folder metadata + a document count, never document
  contents. Corrected here as a documentation-completeness fix (NIT), not a
  security finding.
- **EV-5 (public-intake opt-in), not mentioned in pass 1's doc at all despite
  resolving 2026-08-17, before pass 1 ran:** read `submit_public_event_request`
  in full. Confirmed present and correctly ordered — per-IP rate limit (10),
  then org-exists-and-active, then the opt-in check
  (`pipeline.get("accept_public_requests", False)`, answering identically
  to "org not found" so the gate isn't an oracle), then the honeypot
  (`data.hp_website`, returns the success shape, writes nothing), then the
  per-org daily cap (`daily_cap_exceeded`, counted only after authorization
  and the honeypot so rejected traffic can't exhaust a legitimate
  department's allowance) — exactly the four fronts `KNOWN_LIMITATIONS.md`
  credits it with. This closes a real documentation gap: EV-16 pass 1 is the
  first security-review pass over this feature and never verified or even
  cited EV-5's resolution.
- **RSVP capacity locking, both halves of Pitfall #27**, re-read directly at
  `create_or_update_rsvp` (event lock: `event_service.py:1128`; locking
  count: `:1233`) and `promote_from_waitlist` (event lock: `:1360`; locking
  count: `:1378`) — both present, both in the correct order (lock, then
  locking count, before the capacity decision).
- **EV-11's `template_id` org-check** (`event_service.py:3365`) confirmed
  intact and unchanged.
- **JSON-column mutation discipline** (Pitfall #12) re-checked at every
  write site (`custom_fields` ×3, `task_completions`, `attachments` ×2,
  the template-duplication path): every one either `copy.deepcopy()`s or
  builds a wholly new top-level object before reassigning; none mutates a
  live mapped attribute in place. The one shallow `dict()` call
  (`event_service.py:594`) copies the _client's incoming_ replacement value,
  not `event.custom_fields` itself, to merge in preserved lifecycle keys —
  a different object from the tracked column value, so it does not
  reproduce the shared-reference failure mode Pitfall #12 describes.
- **`get_check_in_monitoring_stats`'s Python-side org comparison**
  (`event_service.py:2944`) confirmed both operands are plain `str` at
  runtime (`User.organization_id`/`Event.organization_id` are
  `String(36)` columns) — fails closed as claimed, just stylistically
  inconsistent with the query-filter idiom used everywhere else.
- **`check_request_status`'s 256-bit token claim** — confirmed at the
  source: `generate_status_token()` (`models/event_request.py:38`) is
  `secrets.token_urlsafe(32)`.
- **Update payloads correctly distinguish omitted from explicit-null**
  (Pitfall #1 mirror) — every update path in `events.py`/`event_service.py`
  uses `model_dump(exclude_unset=True)`; zero uses of `exclude_none`.
- **`/events/` and `/event-requests` cache exclusions** re-checked directly
  in `frontend/src/utils/apiCache.ts`: all six entries pass 1 cited
  (`/event-requests`, `/events/missed-mandatory`, `/rsvps`,
  `/rsvp-history`, `/external-attendees`, `/check-in-monitoring`) are
  present, unchanged.
- **All 12 `ondelete="SET NULL"` FKs across `models/event.py` and
  `models/event_request.py`** confirmed `nullable=True` (grepped every
  site, read the surrounding lines on the two multi-line declarations).

No new findings. No regression in any pass-1 fix.

## Completion gate (pass 2)

| Check                                                                                   | Result                                                                               |
| --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `flake8 app/ tests/ alembic/`                                                           | ✅ 0 violations                                                                      |
| `black --check app/ tests/ alembic/`                                                    | ✅ 1323 files unchanged                                                              |
| `isort --check-only app/ tests/ alembic/` (isort 8.0.1, CI's pin)                       | ✅ clean                                                                             |
| `python3 scripts/validate_migrations.py --strict`                                       | ✅ single head, 389 revisions                                                        |
| `pytest tests/ -k "events or event_request"`                                            | ✅ 177 passed, 1 skipped                                                             |
| `pytest tests/ -k "event"` (broader net — most test files are `test_event_*`, singular) | ✅ 560 passed, 1 skipped                                                             |
| `pytest tests/` (full backend suite)                                                    | ✅ 9181 passed, 22 skipped, 0 failed                                                 |
| `tsc --noEmit`                                                                          | ✅ 0 errors                                                                          |
| `eslint .`                                                                              | ✅ 0 errors, 10 pre-existing warnings (same set as SEC-00/AP-13/EC-14/SCH-15 pass 2) |

No code changes this pass, so no guard test is added; the existing
`test_event_recurrence.py::TestCreateRecurringEventTemplateValidation` (EV-11)
and the full events/event-request suite above continue to cover this
feature's fixed classes.

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
`"events.view"` (one route, `GET /{event_id}/folder` — a baseline member
grant, more restrictive than the bare-`get_current_user` routes above it;
**correction, pass 2:** omitted from this list at first write-up) / an OR of
`"analytics.view","events.manage"`.

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
