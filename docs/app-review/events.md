# Application Review — Events (Tier B, 2nd pass)

**Prefix:** `EV2` · **Iteration:** B17 · **Reviewed:** 2026-08-06

**Backend:** `endpoints/events.py` (2,931 L, 53 endpoints), `endpoints/event_requests.py`
(1,658 L, 18), `services/event_service.py` (3,097 L), model `models/event.py`
**Frontend:** `modules/events`
**Prior audit:** `docs/module-audit/events.md` (iteration 17) — EV-1 (cross-org
location), EV-2 (email XSS), EV-3 (org-scope oracle), EV-4 (dead code) fixed;
EV-5 (public-intake opt-in), EV-6 (RSVP to draft/past), EV-7 (rate-limit +
TypeError) left open.

---

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
