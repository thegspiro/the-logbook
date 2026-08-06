# Module Audit — Events

**Files:** `app/api/v1/endpoints/events.py` (2,931 L, 53 endpoints),
`app/api/v1/endpoints/event_requests.py` (1,658 L, 18 endpoints — incl. the
public outreach event-request pipeline), `app/services/event_service.py`
(3,097 L), model `app/models/event.py`, frontend `modules/events`.
**Audited:** iteration 17 (public event-request surface, attachment
upload/download, tenant isolation, RSVP integrity).

## Verified good ✅
- **Public event-request flow is solid on the critical points:** the target org
  is validated (must exist + `active`); the request is org-stamped server-side;
  the body cannot inject `status`/`assigned_to`/`event_id`/`reviewer_notes`
  (fields mapped explicitly, `status` hardcoded SUBMITTED, assignee from org
  settings); `status_token` is a 256-bit `secrets.token_urlsafe(32)`
  (unique-indexed, not brute-forceable); public cancel rejects terminal states
  (no replay). Status/cancel responses are minimal (no reviewer notes/PII).
- **Tenant isolation is strong.** Every by-id event/RSVP/attachment/series/
  external-attendee/event-request op filters `organization_id`. **XC-3 clean:**
  managers can't review/schedule/assign another org's request; status-update
  org-validates `assigned_to` and `event_id`.
- **RSVP integrity:** self-service RSVP/check-in force `user_id=current_user.id`;
  manager RSVP paths validate the target user is in-org; double-RSVP blocked by a
  unique index; capacity uses `SELECT … FOR UPDATE` with waitlist; series
  generation capped at 365 (DoS-bounded).
- **Attachments:** UUID on-disk filename + ext allowlist + magic-byte MIME check;
  download has a realpath traversal guard; upload/list/delete org-scope the
  parent event.
- No SQL injection; flake8 clean; no TODO.

## Findings

### EV-1 — MEDIUM — Cross-org `location_id` on event create/update — ✅ FIXED
`create_event`/`update_event` (and `create_recurring_event`) stored a
client-supplied `location_id` with no in-org check. The double-booking guard
(`check_overlapping_events`) is a conflict query scoped to the caller's org — not
an ownership check. So an Org-A manager could set an Org-B `location_id`: it was
accepted, `get_event` eager-loads `location_obj` and **returned Org B's location
details** (cross-org disclosure), and the double-booking guard — scoped to Org A —
never saw Org B's real bookings for that room (silently defeating room
double-booking).
**Fix:** validate the location via the org-scoped `LocationService.get_location`
on create, and on update when the location is being (re)set; reject with a clean
error otherwise.

### EV-2 — LOW/MED — Public `contact_name` unescaped in the notification email HTML — ✅ FIXED
`_send_request_notification`'s inline-default path substituted context values
(incl. the public submitter's raw `contact_name`) into the HTML body via
`re.sub(..., str(val), ...)` **without escaping** — unlike the assignee branch
right below, which `_html.escape`s. Mostly self-XSS (recipient is the requester's
own address), but untrusted input in outbound HTML.
**Fix:** HTML-escape every substituted value except the trusted, pre-built
`organization_logo_img`; subject/text bodies stay raw (non-HTML).

### EV-3 — LOW — `rsvp-series` fetched the anchor event without org scoping — ✅ FIXED
`rsvp_to_series` fetched the anchor `Event` by id with no org filter (every other
event fetch has one). Not exploitable for a cross-org write (the service
re-scopes the series query to the caller's org → 0 RSVPs), but an existence
oracle. **Fix:** scoped the anchor fetch to `current_user.organization_id`.

### EV-4 — INFO — Dead code — ✅ FIXED
`upload_event_attachment` instantiated `EventService(db)` and never used it.
Removed.

### EV-5 — MEDIUM (flagged) — Public request intake: no per-org opt-in + weaker anti-spam
Any `active` org's request pipeline can be filled by anyone who supplies its
`organization_id` (freely discoverable via the public calendar/labels/form). The
only gate is per-IP rate-limit 10 — no per-org "accept public requests" toggle,
and (unlike the forms module) no honeypot or per-org daily cap. Each submission
writes rows and triggers assignee/requester emails (notification amplification).
**Status:** flagged — needs a per-org opt-in setting + honeypot/daily-cap parity
with forms (feature + config), not a one-line fix.

### EV-6 — LOW — Members can RSVP to draft / past events — ✅ FIXED (app-review B17)
`create_or_update_rsvp` blocked cancelled events + enforced `rsvp_deadline` but
not `is_draft` events or past events with no deadline set — so a member who knew a
draft's id could RSVP before publication, and an ended event with no deadline still
accepted RSVPs. **Fix (B17):** reject `is_draft` events ("Cannot RSVP to an
unpublished event") and events whose `end_datetime` is in the past ("Cannot RSVP to
an event that has already ended"). 2 regression tests added. See
`docs/app-review/events.md`.

### EV-7 — LOW — `check_request_status` not rate-limited; `send_template_email` TypeError — ⚠️ PARTLY FIXED (app-review B17)
**Fixed (B17):** `send_template_email` coerced every context value with
`"" if value is None else str(value)` before `str.replace`/`html.escape`, so a
`None` base value (missing `contact_name`) or non-str `additional_context` value no
longer raises `TypeError` → 500. **Still accepted:** `check_request_status` has no
IP throttle — the status token is 256-bit, so enumeration is infeasible.

## Notes
- Attachment upload's `except ImportError: pass` silently skips the magic-byte
  MIME check if `python-magic` is missing (falling back to ext-only). `magic` is
  a dependency, so this only matters if it's absent — a minor defense-in-depth
  inconsistency vs the documents module (which requires it).
