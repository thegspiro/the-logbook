# Application Review — Events (Tier B)

**Prefix:** `EV2` · **Iteration:** B17 · **Reviewed:** 2026-08-06 (pass 1),
2026-08-08 (pass 2), 2026-08-09 (pass 3), 2026-08-09 (pass 4),
2026-10-22 (pass 5)

**Backend:** `endpoints/events.py` (2,931 L, 53 endpoints), `endpoints/event_requests.py`
(1,658 L, 18), `services/event_service.py` (3,097 L), model `models/event.py`
**Frontend:** `modules/events`
**Prior audit:** `docs/module-audit/events.md` (iteration 17) — EV-1 (cross-org
location), EV-2 (email XSS), EV-3 (org-scope oracle), EV-4 (dead code) fixed;
EV-5 (public-intake opt-in), EV-6 (RSVP to draft/past), EV-7 (rate-limit +
TypeError) left open.

---

## Pass 5 (2026-10-22) — a null on a required event field answered 500 in four update paths (4 fixed)

Lens for this pass: the update-payload discipline of B4–B16 driven through the real
handlers, and the flush-and-return `updated_at` shape B14 found (GF2-1). The events
service is the one place in the rotation that still writes updates with a bare
`setattr` loop rather than `apply_updates`, so the null probe had somewhere to land.
Every `PATCH` in the module was inventoried (event, series, template, RSVP override,
external attendee, event settings, and the six request-pipeline routes); the ones that
take explicit parameters (`status`, `assign`, `schedule`, `postpone`, `tasks`) and the
RSVP create-or-update (whose `status` and `guest_count` are non-Optional in the schema)
cannot receive a null for a required column and were not changed.

**The B14 shape is absent.** A real change through `PATCH /events/{id}`, the template
and the request email template saves and answers 200: each commits and refreshes before
it responds. `reload_updated_at` is not needed here.

### EV2-3 — LOW/MED — a null on 13 required event fields answered 500 — ✅ FIXED

`update_event` dumped the payload with `exclude_unset` and wrote it with
`setattr(event, field, value)` for each key, with no check that the column accepts NULL.
`EventUpdate` types every field `Optional`, so `null` validates. Reproduced over HTTP, a
`PATCH` with one of `allow_guest_check_in`, `allow_guests`, `check_in_window_type`,
`end_datetime`, `event_type`, `guest_check_in_creates_prospect`, `is_mandatory`,
`reminder_target`, `require_checkout`, `requires_rsvp`, `send_reminders`, `start_datetime`
or `title` as `null` answered **500** and the request's session rolled back. By the code path, the two times
fail on a `TypeError` (the end-after-start comparison runs on `None`) and the rest on an
`IntegrityError` at the flush; the status was observed, the exception types were read from
the code, not captured. A fourteenth, `reminder_schedule`, answered **200**: it is a NOT NULL
JSON column, and SQLAlchemy stores a Python `None` in a JSON column as the JSON literal
`null`, which satisfies the constraint, so the event was left with a stored `null`
where every reader expects a list of hours.

**Fixed** with `reject_null_for_required(instance, updates)` in `utils/model_updates.py`,
the refusal `apply_updates` already makes, made before the update reads its own payload.
`update_event` calls it ahead of the date arithmetic and `update_future_events` calls it on
the first occurrence (it already refused a null start and end by hand); both answer 400 with
"Field 'x' cannot be cleared". The nullable fields (description, location, capacity,
deadline, attendee visibility and the rest) still clear.

### EV2-4 — LOW — a null on 10 required template fields answered 500 — ✅ FIXED

`update_template` had the same `setattr` loop. `allow_guests`, `event_type`, `is_active`,
`is_mandatory`, `name`, `reminder_schedule`, `reminder_target`, `require_checkout`,
`requires_rsvp` and `send_reminders` as `null` all reached the flush and came back 500
(the handler already turns a `ValueError` into a 400, so only the write needed to raise
one). **Fixed** by writing through `apply_updates`.

### EV2-5 — LOW — a null on a required request-pipeline email template field answered 500 — ✅ FIXED

`PATCH /event-requests/email-templates/{id}` looped `setattr` inside the handler. `name`,
`subject`, `body_html` and `is_active` are NOT NULL; each came back 500. **Fixed** with
`apply_updates` and a `ValueError` → 400, the module's own pattern.

### EV2-6 — LOW — a null `name` on an external attendee answered 500 — ✅ FIXED

The attendee edit in `events.py` filtered the payload through an allowlist and then
`setattr`-ed it. `name` is NOT NULL. **Fixed** the same way, keeping the allowlist.

None of these is reachable from the app's own forms — the frontend `EventUpdate` type
allows `null` only on the nullable fields — so each needs a direct client holding
`events.manage`. The cost is a 500 where a 400 was meant, plus (for `reminder_schedule`) one
stored `null` that the reminder sender then has to survive.

Tests: `tests/test_events_update_endpoints_integration.py` (67) and five new cases in
`tests/test_model_updates.py`. The null cases are derived from the update schemas and the
models, so a new column becomes a new case: a NOT NULL column must answer exactly 400 or
422 and keep its value, and a nullable one must be accepted. Four real-change tests assert
200 **and** the value in the table afterwards, with a `get_db` that rolls back on an exception
as `get_session` does. With the three source fixes stashed, 30 of the 67 fail (14 event, 10
template, 4 email template, the series title, the attendee name); 37 pass either way; 0 are
selected under the unit job's marker expression.

### Verified good ✅ (this pass)

- **Nothing unreferenced.** The AST scan (counting `tests/`, `scripts/`, `alembic/`) over
  the three endpoint files, four services, two models and two schemas found no unused
  module-level name or class method, and no `noqa` / `TODO`.
- **Earlier findings still hold.** EV-1 (cross-org `location_id`), EV-8, EV-9 and EV-10 are
  covered by their suites, which pass; EV-7's accepted residual (no IP throttle on the status
  token lookup, a 256-bit token) is unchanged.
- **Org scoping.** The event, template and attendee fetches all filter `organization_id`
  (the attendee one on both the event and the attendee id); the org-scoping ratchet passes.

### Not read (scope, stated plainly)

The 6,176-line event service was read at its update, series and template paths and scanned
for dead names; creation, recurrence expansion, waitlist promotion, finalization and training
credit, the reminder tasks and the public request intake were left to their dedicated suites
(818 tests across 28 files pass). The `modules/events` frontend was read only at its update
payload type.

### Completion gate (pass 5)

| Check                                                           | Result                                                                                            |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `flake8 app/ tests/`                                            | ✅ exit 0, no output                                                                              |
| `black --check app/ tests/`                                     | ✅ 1916 files unchanged                                                                           |
| `isort --check` (changed files)                                 | ✅                                                                                                |
| `mypy` (helper, service, both endpoint files)                   | ✅ no issues                                                                                      |
| Related backend suites (28 files incl. the org-scoping ratchet) | ✅ 818 passed                                                                                     |
| New tests                                                       | ✅ 72 pass; 30 of the 67 integration cases fail without the fixes; 0 under the unit job's markers |
| `check_route_permissions.py --strict`                           | ✅ 0 errors, 0 warnings                                                                           |
| Frontend                                                        | n/a — no frontend change                                                                          |

---

## Pass 4 (2026-08-09) — EV2-2: a cross-org read-leak + a dangling FK on the location paths

A fresh, exhaustive client-FK audit of the whole events surface (a sub-agent traced
every create/update/convert/attendee/rsvp/recurring writer across all three files)
confirmed the EV-8/BXC-1 `location_id` fixes hold on every event-write path — and
found **two** location FKs the prior passes missed on the _adjacent_ surfaces.

### EV2-2 — MED — Two unvalidated `location_id` FKs (one a live cross-org read-leak) — ✅ FIXED

**GAP 1 — `schedule_request` (event-request → event conversion) — a real read-leak.**
`POST /event-requests/{id}/schedule` stored `event_location_id = data.location_id`
**unconditionally** (event_requests.py), but only validated the location in-org
_inside_ the `if data.create_calendar_event:` branch (which reaches the EV-8
`create_event` check). With `create_calendar_event` **False — the default** — a
foreign `location_id` was stored with no org check, and the response enrichment
`_get_location_name` resolved it with **no org filter** — so a manager could
`schedule` a request with another org's `location_id` and read that org's location
name back in `event_location_name` on every subsequent GET. The exact XC-1
name-projection leak shape (EC2-4 / TR-3 / TR-7 family). **Fix, two layers:** (1)
org-scope `_get_location_name` (now takes `organization_id`, filters
`Location.organization_id`) — the definitive guard, so any pre-existing foreign id
resolves to no name; (2) validate `data.location_id` in-org on the write path via
`assert_in_org` (surfaced as a clean 400, since `schedule_request` had no
`ValueError` wrapper).

**GAP 2 — `create_template` / `update_template` — a dangling FK.** Both stored the
client `default_location_id` via a blind `**dict` / `setattr` with no check. This is
**not** a read-leak today (`EventTemplateResponse` echoes the raw UUID, has no
`location_name`, and no server-side "create event from template" path copies it into
`Event.location_id`), but it's a genuine unvalidated org-scoped FK. **Fix:** a shared
`_assert_template_location_in_org` (mirroring EV-8's `LocationService.get_location`
check) on both paths, plus the module-standard `except ValueError → 400` on both
template endpoints (they previously had none — the same latent-500 shape).

**6 DB-free tests added** (`test_event_request_location_scoping.py`): template
create/update reject a foreign `default_location_id` and skip when absent; the
enrichment is org-scoped (no-match → None, in-org → name).

### Still flagged (unchanged)

- **EV-5** (public request intake: per-org opt-in + honeypot/daily-cap parity —
  feature + config), **EV-7 logo** (exempt `organization_logo_img` from escaping if
  the logo should render).

**Completion gate (pass 4):** `flake8` 0 · `black --check` clean · `tsc --noEmit`
n/a (no frontend change) · `test_event_request_location_scoping.py` **6 passed** +
`test_event_enum_validation.py` unchanged (all DB-free).

---

## Pass 3 (2026-08-09) — large latent-500 on event/RSVP enums

Re-verified the landed fixes hold: EV-8 (`create_event`/`update_event` validate
`location_id` in-org, service ~74/301), EV-9 (`end_event` audit signature), EV-10
(draft events excluded from public feeds), EV-1/2/6/7. `event_service.py` is
E712-free. The B1 enum lens then surfaced the module's largest latent-500 surface.

### EV2-1 — LOW/MED — event/RSVP enum fields 500 on a bad value — ✅ FIXED

**What:** four enum columns — `event_type`, `check_in_window_type` (Event),
`recurrence_pattern` (RecurringEvent), and RSVP `status` — are **strict MySQL ENUMs**,
but were typed as free `str` across **nine request schemas**
(`EventCreate`/`EventUpdate`, `EventDefaultsUpdate`, `EventTemplateCreate`/`Update`,
`RecurringEventCreate`, `RSVPCreate`, `ManagerAddAttendee`, `BulkAddAttendees`) and
inserted **raw** (`create_event` via `Event(**dict)`, the update `setattr` loops, the
RSVP/template creates). The schemas had **no** `field_validator`, so an out-of-set
value passed Pydantic, reached MySQL, and 500'd. The B1 class, at the widest scale
seen this pass.

**Fix:** a shared `_enum_check(valid, field)` helper + `@field_validator`s on all nine
request classes, each deriving its value set from the model enum (`EventType`,
`CheckInWindowType`, `RecurrencePattern`, `RSVPStatus`), lowercase-normalizing and
rejecting unknowns → 422. Validators live on the concrete **request** classes, not the
shared `EventBase`/`RSVPBase` (which the response schemas inherit), so responses are
untouched. **10 tests added.**

### Still flagged (unchanged)

- **EV-5** (public request intake: per-org opt-in + honeypot/daily-cap parity with
  forms — feature + config), **EV-7 logo** (exempt `organization_logo_img` from
  escaping in `send_template_email` if the logo should render).

**Completion gate (pass 3):** `flake8` 0 · `black --check` clean · `tsc --noEmit`
n/a (no frontend change) · new enum tests **10 passed** + existing event tests
**139 passed** (all DB-free; the `db_session` errors are unrelated files matched by
the `-k` substring).

---

## Pass 2 (2026-08-08) — six-lens sweep

Re-verified pass-1 (EV-1–4 solid; EV-6 rejects draft/past RSVPs; EV-7 coerces
None context values). The six-lens sweep found **3 fixes** — one a live crash on a
core action, one a public data leak, one a cross-org read-leak on the recurring
path pass-1's non-recurring focus didn't cover.

### EV-9 — MED — `end_event` 500'd on every call (wrong audit-log signature) — ✅ FIXED

`log_audit_event(db, event_type, event_category, severity, event_data, **kwargs)`
requires those four named args, but the `end_event` endpoint called it with the
`action=`/`resource_type=`/`resource_id=`/`details=` shape (none of the four
required params) → `TypeError` → uncaught `500`. This is the **only** audit call
in `events.py` using that shape; every sibling (`event_created`/`_updated`/
`_deleted`/`_checkin`) uses the correct one. Worse, `service.end_event` had
**already committed** the actual-end-time + bulk-checkout before the audit call,
so the event ended but the caller always got a 500. **Fix:** rewrite to the
canonical shape (`event_type="event_ended"`, `event_category="events"`,
`severity="info"`, `event_data={...}`, `user_id`, `username`).

### EV-10 — LOW-MED — Unpublished draft events surfaced on public event feeds — ✅ FIXED

`get_public_calendar` (unauthenticated, `events.py`) and the public-portal events
query (`api/public/portal.py`) both filtered org + public types + future +
not-cancelled but **not `is_draft`**, so a draft public_education/fundraiser event
was visible to the public before publication — while the authenticated
`list_events` excludes drafts by default. **Fix:** both queries now add the same
draft filter the service's tested `list_events` uses —
`or_(Event.is_draft.is_(False), Event.is_draft.is_(None))`. Swept the adjacent
`is_cancelled == False  # noqa: E712` on the public calendar to `.is_(False)`.

### EV-8 — MED — `create_recurring_event` stored a client `location_id` unvalidated → cross-org location leak — ✅ FIXED

`create_event`, `update_event`, and (via the BXC sweep) `update_future_events` all
validate `location_id` in-org before storing it; `create_recurring_event` spread
it straight into every occurrence via `**event_data`. The occurrences are then
re-queried with `selectinload(Event.location_obj)` and the response projects
`location_obj.name`, so a foreign `location_id` leaked another org's location name
on every occurrence — the exact BXC-1 class already fixed on the single-event
paths. **Fix:** the same in-org `LocationService.get_location` guard before
generating occurrences, returning `([], "Location not found")` per the method's
error-tuple convention. (The double-booking parity check was intentionally left
out — running it per-occurrence is a behavior change beyond closing the leak.) 1
DB-free regression test (foreign location rejected).

**Flagged (unchanged / new LOW):** EV-5 (public-intake opt-in + anti-spam) stands.
New lower-priority items left for a hardening pass: recurring `template_id` stored
unvalidated (dangling, not projected — no read-back leak); `EventUpdate.attachments`
is a free-form list written by the blind setattr loop and the attachment-download
guard checks the base upload dir but not the org subdir (not exploitable — files
use unguessable uuid4 names — but the guard should be org-scoped);
`get_check_in_monitoring_stats` fetches the event by id then compares org in Python
(fail-closed, but deviates from the scope-in-SQL standard). All recorded here.

---

## Pass 1 (2026-08-06)

## Scope

Tier B: the open findings. The heavy security surfaces — public event-request
intake, attachment upload/download, RSVP integrity, tenant isolation — were solid
and re-confirmed. This pass fixed the two actionable correctness items (EV-6, the
EV-7 TypeError) and re-flagged the intake-hardening feature (EV-5).

## Findings

### EV-6 — LOW — Members could RSVP to draft or already-ended events — ✅ FIXED

`create_or_update_rsvp` blocked cancelled events and enforced `rsvp_deadline`, but
had no guard for two states:

- **Draft events.** `get_event` filters `is_draft` for normal reads, but the RSVP
  path fetches the event directly (row-locked for the capacity check), so a member
  who knows a draft's id could RSVP before publication. Now rejected with "Cannot
  RSVP to an unpublished event".
- **Past events with no deadline.** The `rsvp_deadline` check only fires when a
  deadline is set; without one, an event that already happened still accepted
  RSVPs. Now rejected when `end_datetime` is in the past — `end_datetime` is
  non-null on every event, so this is the unambiguous "event is over" gate (it
  doesn't touch ongoing events, where check-in, not RSVP, is the mechanism).

**2 regression tests added** (`test_draft_event_rejected`, `test_ended_event_rejected`).

### EV-7 — LOW — `send_template_email` 500'd on a non-str / None context value — ✅ FIXED

The template-email substitution did `subject.replace(k, value)` and
`_html.escape(value)` directly on every context value. The base context includes
values that can be `None` (e.g. a missing `contact_name`), and `str.replace` /
`html.escape` raise `TypeError` on a non-str — a 500 on an `events.manage` action.
**Fix:** coerce each value with `"" if value is None else str(value)` before
substitution. (The other half of EV-7 — no rate-limit on `check_request_status` —
remains acceptable: the status token is 256-bit, so enumeration is infeasible.)

**Observed, not changed:** this function escapes `organization_logo_img` along with
everything else, so a template referencing `{{organization_logo_img}}` renders the
logo `<img>` as literal text — unlike EV-2's notification path, which exempts the
trusted pre-built logo. Left as-is (escaping is the safe direction; un-escaping it
is a template-rendering behavior change outside this finding). Noted for future.

### EV-5 — MEDIUM — Public request intake: no per-org opt-in + weaker anti-spam — ✅ RESOLVED (2026-08-17)

Any `active` org's request pipeline can be filled by anyone who supplies its
`organization_id` (discoverable via the public calendar). The only gate is a
per-IP rate-limit of 10 — no per-org "accept public requests" toggle and, unlike
the forms module, no honeypot or per-org daily cap; each submission writes rows and
fires assignee/requester emails (notification amplification). Needs a per-org
opt-in setting + honeypot/daily-cap parity with forms — a feature, not a one-line
fix. Recorded in `KNOWN_LIMITATIONS.md`.

**Resolved 2026-08-17** (`KNOWN_LIMITATIONS.md`; this doc missed the update).
Independently re-verified against the current code by security-review EV-16
pass 2 (2026-08-28): `submit_public_event_request` now checks, in order, the
per-IP rate limit, a per-org opt-in (default off, answering identically to
"org not found"), a honeypot, and a per-org daily cap counted only after
authorization. See `docs/security-review/EV-16-events-requests.md` for the
full trace.

## Cleanup applied

Swept all 8 `== True`/`== False  # noqa: E712` suppressions in `event_service.py`
to `.is_(True)`/`.is_(False)` (incl. the `or_(is_draft == False, is_draft.is_(None))`
compound) — the AP-2 pattern, Pitfall #10.

## Verified good ✅ (re-confirmed)

- EV-1 (`location_id` validated org-scoped on create/update), EV-2 (public
  `contact_name` escaped in notification HTML), EV-3 (`rsvp-series` anchor
  org-scoped), EV-4 (dead `EventService` removed) all hold.
- Public request flow org-stamps server-side, hardcodes `status=SUBMITTED`, uses a
  256-bit `status_token`; RSVP self-service forces `user_id=current_user.id`;
  capacity uses `SELECT … FOR UPDATE`; series generation capped at 365; attachments
  UUID-named + magic-byte checked + traversal-guarded.

## Documentation

`docs/module-audit/events.md` updated: EV-6/EV-7 resolved; EV-5 stands.

## Future development

1. ~~**EV-5** — per-org public-intake opt-in + honeypot/daily-cap parity with
   forms.~~ ✅ Resolved 2026-08-17.
2. **EV-7 logo** — exempt `organization_logo_img` from escaping in
   `send_template_email` (mirroring EV-2) if templates should render the logo.

## Completion gate

| Check                                | Result                                                                                                                                                    |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `flake8` (service + endpoint + test) | ✅ 0 violations                                                                                                                                           |
| `black --check`                      | ✅ formatted                                                                                                                                              |
| `tsc --noEmit`                       | ✅ n/a — no frontend change                                                                                                                               |
| backend tests                        | ✅ `test_event_rsvp_waitlist` **15 passed** (+2 new EV-6). The `_event` mock factory was extended with `is_draft`/`end_datetime` defaults (not weakened). |
