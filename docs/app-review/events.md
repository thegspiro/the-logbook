# Application Review — Events (Tier B)

**Prefix:** `EV2` · **Iteration:** B17 · **Reviewed:** 2026-08-06 (pass 1),
2026-08-08 (pass 2)

**Backend:** `endpoints/events.py` (2,931 L, 53 endpoints), `endpoints/event_requests.py`
(1,658 L, 18), `services/event_service.py` (3,097 L), model `models/event.py`
**Frontend:** `modules/events`
**Prior audit:** `docs/module-audit/events.md` (iteration 17) — EV-1 (cross-org
location), EV-2 (email XSS), EV-3 (org-scope oracle), EV-4 (dead code) fixed;
EV-5 (public-intake opt-in), EV-6 (RSVP to draft/past), EV-7 (rate-limit +
TypeError) left open.

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

### EV-5 — MEDIUM — Public request intake: no per-org opt-in + weaker anti-spam — 🚩 FLAGGED (feature + config)

Any `active` org's request pipeline can be filled by anyone who supplies its
`organization_id` (discoverable via the public calendar). The only gate is a
per-IP rate-limit of 10 — no per-org "accept public requests" toggle and, unlike
the forms module, no honeypot or per-org daily cap; each submission writes rows and
fires assignee/requester emails (notification amplification). Needs a per-org
opt-in setting + honeypot/daily-cap parity with forms — a feature, not a one-line
fix. Recorded in `KNOWN_LIMITATIONS.md`.

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

1. **EV-5** — per-org public-intake opt-in + honeypot/daily-cap parity with forms.
2. **EV-7 logo** — exempt `organization_logo_img` from escaping in
   `send_template_email` (mirroring EV-2) if templates should render the logo.

## Completion gate

| Check | Result |
|-------|--------|
| `flake8` (service + endpoint + test) | ✅ 0 violations |
| `black --check` | ✅ formatted |
| `tsc --noEmit` | ✅ n/a — no frontend change |
| backend tests | ✅ `test_event_rsvp_waitlist` **15 passed** (+2 new EV-6). The `_event` mock factory was extended with `is_draft`/`end_datetime` defaults (not weakened). |
