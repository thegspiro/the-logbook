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

## Pass 3 (2026-09-04) — Codex follow-up (same PR): 3 fixes (1 P1 correctness), 2 flagged, 1 scope correction

**PR:** [#2213](https://github.com/thegspiro/the-logbook/pull/2213).
**Scoped since pass 2's merge:** `fef19238` (PR #1973).

> **Correction (Codex review of this PR).** The first draft of this section
> claimed "no new findings, no code changes" — that was wrong. Codex raised
> six comments against it; five are real (one P1 correctness bug this draft's
> own "narrowing, not a new exposure" line had missed, one P2 schema gap, one
> P2 pre-existing data-loss bug this draft surfaced without fixing, one P2
> scope gap, one P2 ordering bug flagged rather than fixed) and one (the
> phase-gate finding) is real but flagged, not fixed, for the reason given
> under **Findings (pass 3)** below. The section below is the corrected one;
> see the Log for the blow-by-blow.

Five months of feature work sit between pass 2 and now on `main` generally,
but diffed narrowly (per file, not by line-count growth) against `fef19238`
for the nine files pass 2 declared plus a fresh grep for any other file
importing the Event/EventRequest models or instantiating either service —
none found, so the surface is unchanged from pass 2's own enumeration.

**Of the nine, five actually changed:** `api/v1/endpoints/events.py`
(+182/-18), `models/event.py` (+24), `schemas/event.py` (+135/-4),
`services/event_service.py` (+434/-98), `utils/event_attachments.py`
(+19/-3, comment-only — the `Dict[str, Any]` type-check rationale expanded,
no logic change). `event_requests.py`, `event_request_service.py`,
`models/event_request.py` and `schemas/event_request.py` are **byte-identical**
to pass 2 — confirmed via `git diff --stat`, not assumed from the "no PR
touched these" changelog. One new migration,
`20260901_0001_c3a71e5d9b48_add_event_attendee_visibility.py`.

**The whole diff is one feature: member-visible attendee rosters, plus the
seat-accurate capacity/waitlist rework it depended on.** Read in full, not
sampled, against all seven checklist dimensions:

- **New endpoint `GET /{event_id}/attendees`** (`events.py`) — gated
  `require_permission("events.view")` (a baseline member grant), then a
  second, per-event check: `resolve_attendee_visibility(event, org.settings)`
  must resolve to `AttendeeVisibility.MEMBERS` **or** the caller must
  additionally hold `events.manage`. The event is fetched org-scoped first
  and a miss returns **404** before the visibility check ever runs — a
  foreign event id can't be used to probe another org's visibility setting
  (XC-3/Pitfall #14a-b). `resolve_attendee_visibility` fails closed three
  ways: no per-event override falls to the org default; no org default (or an
  org whose `settings` JSON has no `events.defaults` path) falls to
  `MANAGERS`; an unrecognized stored string (unvalidated JSON — some other
  write path could in principle put anything there) logs a warning and also
  resolves to `MANAGERS` rather than raising or defaulting open. Every
  installation's existing events keep manager-only rosters on upgrade — the
  migration backfills nothing, by design (NULL is a real "inherit" state, not
  a missing value).
- **`EventAttendeeResponse` is a hand-written allowlist** (`user_id`,
  `user_name`, `status`), explicitly **not** built on `RSVPResponse`/
  `RSVPBase` — which carry `user_email`, `notes`, `dietary_restrictions`,
  `accessibility_needs`, `guest_count` and the check-in/override block. The
  docstring names the reason (inheriting to save lines is how those fields
  would reach every member) and the service method backing it
  (`list_event_attendees_for_member`) queries only `going` RSVPs — no
  `status_filter` parameter, so `waitlisted`/`not_going`/contact rows are
  structurally unreachable through this path, not merely unrendered.
- **`UserRSVPSummary` (the caller's own RSVP, echoed on `GET /events/{id}`
  for modal prefill) deliberately omits `dietary_restrictions` and
  `accessibility_needs`.** The docstring gives the actual reason and it
  checks out: `GET /events/{id}` is not in `UNCACHEABLE_PREFIXES` /
  `UNCACHEABLE_SUBSTRINGS` (confirmed by reading
  `frontend/src/utils/apiCache.ts` directly — the events exclusions are all
  sub-resources: `/rsvps`, `/rsvp-history`, `/external-attendees`,
  `/check-in-monitoring`, `/missed-mandatory`), so putting accommodation/PHI-
  adjacent fields on the cached detail response would have made the app's
  most-visited event endpoint a PHI-bearing, cacheable one. Confirmed the
  fields are genuinely absent from the schema, not merely unset — `git grep`
  for `dietary_restrictions\|accessibility_needs` in `schemas/event.py` finds
  them only on `RSVPBase`/`RSVPResponse`.
- **`get_eligible_members` (`events.manage`) now routes email through
  `load_contact_policy`/`policy.email_for(member)`** instead of returning
  `member.email` unconditionally. `contact_visibility.py` is a pre-existing,
  already-reviewed shared utility (also used by `forms_service.py`); reading
  it here confirms it resolves the same profile-visibility-vs-manager-ceiling
  policy the member directory already applies, keyed off
  `user_has_permission(current_user, "members.manage")` — correctly, since
  `events.manage` and `members.manage` are separate grants and a coordinator
  who can run events is not automatically a member of the roster's
  visibility ceiling. This is a **narrowing** of what this endpoint returned
  before (previously unconditional), not a new exposure.
- **Capacity/waitlist rework changes arithmetic, not authorization or
  tenancy — re-checked anyway since it touches the RSVP write path
  CLAUDE.md pitfall #27 is specifically about.** Both locking halves are
  still present and in the correct order at both call sites:
  `create_or_update_rsvp` locks the event row then takes a locking read of
  occupied seats (now `SUM(1 + guest_count)` instead of `COUNT(*)`, matching
  the new allow_guests-aware capacity model) before the waitlist decision;
  `promote_from_waitlist` now fetches-and-locks the earliest **fitting**
  waitlisted row first, then re-verifies capacity with its own locking sum
  before promoting — re-ordered from pass 2's shape (capacity check, then
  fetch) specifically because capacity now depends on the fetched row's own
  `guest_count`, and the promotion loop bound
  (`MAX_WAITLIST_PROMOTIONS_PER_RELEASE = 50`) is a defensive cap on a
  same-request loop, not a trust boundary. `rsvp_to_series` no longer
  hand-rolls its own insert (which pass 2's audit never reached because
  pass 1/2 both scoped to `create_or_update_rsvp`/`promote_from_waitlist`
  by name) — it now delegates per-occurrence to `create_or_update_rsvp`
  itself, so the series path inherits the same lock, capacity math,
  `allow_guests` gate and deadline/draft checks instead of duplicating (and
  drifting from) them. Confirmed the per-occurrence `rollback()` on a
  refused occurrence discards only that attempt's uncommitted write, since
  `create_or_update_rsvp` commits its own successes.
- **`attendee_visibility` migration** — two `nullable=True` String(20)
  columns on `events` and `event_templates` (both `create_table`-created,
  not `create_all`-only), no `ondelete` involved, no backfill (correctly —
  NULL is the inherit state). Single-head confirmed.
- **No new unauthenticated route, no new client-supplied FK, no new SQL/LIKE
  surface, no new CSV/export path.** `duplicate_event` and the recurring-
  occurrence generator now carry `attendee_visibility` forward explicitly
  (a duplicated or recurring event does not silently revert a manager's
  chosen roster visibility to the org default) — read at both call sites,
  plain field copy, no new write surface.
- **Frontend:** `git diff --stat` against `fef19238` over the pass-2-
  established 74-file surface finds 21 changed (listed in full in the
  completion gate below); re-ran the same sweep pass 2 used
  (`window.confirm`/`alert`/`prompt`, `dangerouslySetInnerHTML`, banned
  `.toLocale*`, `date-fns` import, direct `fetch(`, `localStorage`) over all
  21 — zero new hits; the two pre-existing `localStorage` uses in
  `EventsPage.tsx` (filter presets) are unchanged. New
  `EventAttendeesCard.tsx` read in full: calls the new endpoint, renders
  `user_name`/`status` only, and treats a 403 as "roster not shared" rather
  than an error state — it does not attempt to fall back to
  `GET /{id}/rsvps` (the `events.manage` endpoint) on a permission failure,
  so there's no path where a denied member-facing call silently upgrades to
  the manager view.

### Scope correction — the events-specific MCP tools (Codex review of this PR)

The declared surface (nine backend files) is what pass 2 enumerated, but a
repository-wide check for "any other file instantiating either service" only
covered files that _changed_ in this diff — it never asked whether an
already-existing, never-reviewed file used the models. Two do:
`app/mcp/tools/events.py` (`list_events`/`get_event`/
`get_event_description`/`list_event_attendees`) and
`app/mcp/tools/writes.py` (`create_event_draft`, ~line 122). Both predate
this diff and were added after `fef19238` without ever being swept into a
security-review pass — the same class of gap SCH-15 pass 3 hit for its own
feature's MCP tool file, and the fix is the same: read the feature-specific
file now rather than deferring it to a hypothetical future MCP-wide pass
(the wider, cross-feature MCP surface stays out of scope and is tracked
separately in `KNOWN_LIMITATIONS.md`).

Both read in full. `events.py`'s four tools mirror the REST endpoints'
protections exactly: every query is org-scoped via `org_uuid(principal)`,
`get_event`/`get_event_description` raise (a clean error, not a 404-vs-403
oracle) on a foreign or unknown id before returning anything,
`list_event_attendees` calls the same `list_event_attendees_for_member` +
`resolve_attendee_visibility` pair the REST `GET /{event_id}/attendees`
uses and returns the same allowlisted shape (member id/name/status only —
no guest count, no response time, no check-in detail), and unbounded text
columns (`description`, `location_details`) are scrubbed and paginated in
20,000-character chunks rather than returned whole. One deliberate,
correct divergence from the REST endpoint: `list_event_attendees` here does
**not** have an `events.manage`-holder fallback for a managers-only roster —
it fails closed to "not shared" outright, which is right, since an MCP
service key is not a department member and has no such permission to check.
`writes.py`'s `create_event_draft` constructs a validated `EventCreate` from
a fixed, narrow field set (title/description/type/location string/times) —
no client-supplied `location_id`, `template_id`, `attachments` or
`attendee_visibility` — always `is_draft=True` and `send_reminders=False`,
and creates through the same org-scoped `EventService.create_event`. Clean,
no finding; recorded here so "full event surface reviewed" is true rather
than approximately true.

## Findings (pass 3)

### EV-20 — P1 (correctness) — `EligibleMemberResponse.email` was a required `str`; a hidden email 500'd the whole roster — ✅ FIXED

**Reported by Codex on this PR; confirmed.** Pass 3's own first draft
described `get_eligible_members`'s switch to `policy.email_for(member)` as
strictly "a narrowing, not a new exposure" — true for what it returns, but
it missed what the schema requires. `email_for()` returns `None` whenever
the org's `contact_info_visibility.show_email` ceiling is off (a common,
even default, configuration) or the individual member hid their own email,
while `EligibleMemberResponse.email` was declared as a required `str`.
FastAPI's response-model validation fails the **entire** response — not
just the one row — the first time any member in the org has a hidden
email, turning `GET /{event_id}/eligible-members` (the check-in roster) into
a 500 for that event. The existing unit test for this path
(`test_events_eligible_members_visibility.py`) called the endpoint function
directly and never exercised this: it checks the dict the function returns,
not what happens when FastAPI validates that dict against the response
model, which is exactly where this failed.

**Fix:** `email: Optional[str] = None` on `EligibleMemberResponse`
(`app/schemas/event.py`). Frontend: `EligibleMember.email` widened to
`string | null` in `EventCheckInModal.tsx`, `eventServices.ts` and
`EventDetailPage.tsx`; the modal's search filter
(`member.email.toLowerCase()`) — which Codex separately flagged as its own
follow-on crash once the field is nullable — now reads
`(member.email ?? '').toLowerCase()`. The bare `{member.email}` display
line needed no change: React renders `null` as nothing.

**Guard test:** `test_events_eligible_members_visibility.py::
TestEligibleMembersEmail::test_hidden_email_survives_response_model_validation`
constructs `EligibleMemberResponse(**rows[0])` directly (rather than calling
the endpoint function alone) so a future regression in the schema, not just
the endpoint logic, fails the suite.

### EV-21 — P1 (data loss) — RSVP update overwrote `dietary_restrictions`/`accessibility_needs` with `NULL` on every unrelated edit — ✅ FIXED

**Reported by Codex on this PR; confirmed as pre-existing, not introduced by
this diff — this pass owns it per CLAUDE.md's "no acceptable pre-existing
errors."** `create_or_update_rsvp`'s update branch applied
`rsvp_data.model_dump()` (a **full** dump) over the existing row's every
field. The RSVP modal (`useRSVPForm.ts`) has always reopened
`dietary_restrictions`/`accessibility_needs` blank on purpose — they are
PHI-adjacent and `GET /events/{id}` is a cacheable response
(`UserRSVPSummary`'s own docstring, added this same diff, explains exactly
why they can't be echoed back) — so the modal has no way to show the
member their current value. A blank box therefore means "not touched," not
"clear it," but the full-dump update sent that blank back as an explicit
`None` regardless: a member editing their guest count, notes, or status —
anything — silently deleted their own previously-recorded allergy or
mobility-accommodation note, with no error and no warning. This is
independent of, and predates, this pass's own diff; it became reachable in
practice the moment the app stopped showing these fields back, and nothing
in pass 1 or 2 exercised an RSVP edit against a row that already had them
set.

**Fix:** the update branch now applies
`rsvp_data.model_dump(exclude_unset=True)` — an omitted key leaves the
stored value alone (CLAUDE.md Pitfall #1's update mirror). This also
required making the frontend's own "clear notes by blanking the box"
behavior explicit rather than implicit: `notes` is now always sent
(`rsvpNotes.trim() || null`, never omitted) so a member who deletes their
note still gets it cleared; `dietary_restrictions`/`accessibility_needs`
keep the existing omit-when-blank behavior, which is now _correct_ instead
of accidentally safe. `RSVPCreate.notes` widened to `string | null |
undefined` in `types/event.ts` to carry the explicit null.

**Guard test:**
`test_event_lifecycle.py::TestEventRSVP::test_update_preserves_omitted_accommodation_fields`
— sets both fields, then submits an update that only changes `guest_count`
and asserts both survive unchanged; a third submission that explicitly
sends `dietary_restrictions=""` confirms an actual edit still clears it
(exclude_unset protects an _omitted_ field, not one the client genuinely
changed).

### EV-22 — P2 (schema gap, XC-1 adjacent) — `RecurringEventCreate` had no `attendee_visibility` field; a series' visibility choice was silently dropped — ✅ FIXED

**Reported by Codex on this PR; confirmed.** `EventCreate`, `EventUpdate`,
`EventTemplateCreate` and `EventTemplateUpdate` all declare
`attendee_visibility` — `RecurringEventCreate` was the one event-create
schema that didn't, even though `EventForm.tsx`'s `formData` (shared across
all four create/update paths) always includes it and `RecurringEventCreate`
already carries `attachments` for the same "series built from the same form"
reason. Pydantic silently drops unrecognized keys by default (no
`extra="forbid"` anywhere in this schema file), so the field never reached
`create_recurring_event`, and every generated occurrence stored `NULL`
(inheriting the org default) regardless of what the organizer picked.
Concretely: an org whose default is member-visible, with an organizer
deliberately choosing managers-only for a sensitive recurring series, would
have that choice dropped and the roster exposed to members on every
occurrence — silently, with a 201 that looked like it worked.

**Fix:** added `attendee_visibility: Optional[str] = Field(None,
max_length=20)` plus the same `_check_attendee_visibility` enum validator
the other four schemas use. No service-layer change needed:
`create_recurring_event` already spreads `**event_data` onto every
constructed `Event(...)`, so once the field survives the schema it flows
through on its own — the same mechanism that already carries
`attendee_visibility` forward correctly on `duplicate_event`.

**Guard test:**
`test_event_recurrence.py::TestCreateRecurringEventAttendeeVisibility` — one
case asserting the field round-trips through `model_dump()` (the actual
mechanism `create_recurring_event` depends on, not just "the schema accepts
it"), one asserting an invalid value is still rejected.

### EV-23 — P2 (flagged, not fixed) — series RSVP never shows the training phase-gate warning it claims to have already confirmed

**Reported by Codex on this PR; confirmed, not fixed.** An individual RSVP
to a session ahead of the member's current training-pipeline phase gets a
409 with a soft, overridable warning (`_evaluate_session_phase_warning`),
which `useRSVPForm.ts` catches and turns into a confirm dialog before
retrying with `override=True`. `rsvp_to_series` — rewritten this pass to
delegate to `create_or_update_rsvp` per occurrence instead of hand-rolling
its own insert — passes `override=True` **unconditionally** for every
occurrence, with a comment claiming "the member confirmed the training
phase-gate warning once for the series." No such confirmation exists
anywhere in the series path: `useRSVPForm.ts`'s series branch
(`rsvpApplyToSeries`) calls `eventService.rsvpToSeries` directly with no
409/warning handling at all, and the backend `POST /events/{id}/rsvp-series`
endpoint has no `override` parameter to receive one. So a member applying
to a whole series silently skips a warning an individual RSVP to the exact
same session would have required them to acknowledge.

**Not fixed here, deliberately.** A correct fix needs a product decision
this pass isn't positioned to make on its own: a series can span sessions in
different phases, so "the" phase-gate warning for a series submission isn't
single-valued the way it is for one event — does the series endpoint warn
once for the _first_ ahead-of-phase occurrence found, list every one, or
warn only if _any_ occurrence would? Any of the three is a defensible
answer and a real API/response-shape change (a new 409 shape from
`POST /events/{id}/rsvp-series`, new frontend confirm-and-retry handling
mirroring the single-RSVP path). Getting it wrong risks either an
unactionable wall of warnings or silently picking the weakest of the three.

**Impact:** LOW/MED. Soft and overridable even in the working case — this
is a training-pipeline advisory, not an authorization or tenancy boundary —
so the exposure is a member proceeding without a nudge they'd have gotten
individually, not unauthorized access to anything.

**Recommendation for whoever picks this up:** warn once per series
submission, keyed on the _earliest_ ahead-of-phase occurrence (matching how
`promote_from_waitlist` and the capacity model elsewhere in this diff always
resolve "which one" by earliest first), and thread a genuine `override`
query/body parameter through `rsvp_to_series` mirroring the single-RSVP
endpoint's shape.

### EV-24 — P2 (flagged, not fixed) — editing an existing waitlisted RSVP can promote it out of order

**Reported by Codex on this PR; confirmed.** The ordering guarantee
(earliest-`responded_at`-first) is enforced by `promote_from_waitlist`
alone. `create_or_update_rsvp`'s own capacity check — which also runs when
a member merely _edits_ an existing RSVP that happens to already be
`WAITLISTED` (the modal always resubmits `status: "going"` for a waitlisted
member, per `useRSVPForm.ts`'s `openModal`) — only asks "is there room for
**this** party," never "is anyone ahead of this one in the queue." Concrete
scenario: two seats are free; the head of the queue needs three (too big to
fit yet); a member further back with a one-person party reopens their
(prefilled) RSVP modal and resubmits without changing anything. Their
update goes through `create_or_update_rsvp`, finds two free seats, fits
one person, and promotes them straight to `GOING` — ahead of the party that
has been waiting longer and whose position the member-facing UI (per-member
`user_waitlist_position`, added this same diff) explicitly promised was
ahead of theirs.

**Not fixed here.** The capacity-locking discipline this exact write path
carries (Pitfall #27, both halves) is delicate enough that a same-pass,
same-reviewer patch risks trading a fairness bug for a correctness one —
e.g., naively refusing to ever promote from this path would also block the
legitimate case of the actual queue head reducing their own guest count to
fit. This needs the fix aimed specifically at "is this row the earliest
_fitting_ waitlisted row," which is exactly the query
`promote_from_waitlist` already has, and doing that correctly deserves its
own change and its own test pass rather than a same-day patch bolted onto
an unrelated review's completion gate.

**Impact:** LOW/MED. A fairness/ordering defect, not a tenancy or capacity-
correctness one — the event is never actually oversubscribed by this path
(the party still has to fit), and it cannot be triggered by a party larger
than the actual free capacity. The harm is queue-jumping, not overbooking.

**Recommendation:** route this specific case (existing row is `WAITLISTED`,
new status is `GOING`) through the same "am I the earliest fitting
waitlisted row" check `promote_from_waitlist` performs, rather than the bare
capacity comparison, so a resubmission can only succeed when the normal
promotion order would have reached this row anyway.

**No regression in any pass-1/pass-2 fix.** Rotation row 15 (this doc is
still filed as EV-16, feature 16) → see `PROGRESS.md`.

## Completion gate (pass 3)

| Check                                                         | Result                                               |
| ------------------------------------------------------------- | ---------------------------------------------------- |
| `flake8 app/ tests/ alembic/`                                 | ✅ 0 violations                                      |
| `black --check app/ tests/ alembic/`                          | ✅ 1453 files unchanged                              |
| `isort --check-only app/ tests/ alembic/`                     | ✅ clean                                             |
| `python3 scripts/validate_migrations.py --strict`             | ✅ single head, 414 revisions (no schema change)     |
| `pytest tests/ -k "event"`                                    | ✅ 673 passed, 1 skipped (pre-existing)              |
| `pytest tests/` (full backend suite)                          | ✅ 10553 passed, 21 skipped (pre-existing), 0 failed |
| `tsc --noEmit`                                                | ✅ 0 errors                                          |
| `eslint .`                                                    | ✅ 0 errors                                          |
| `npx vitest run src/pages/EventDetailPage.test.tsx src/hooks` | ✅ 224 passed (26 files)                             |

Frontend files diffed for the initial sweep: `EventForm.tsx`/`.test.tsx`,
`EventTemplateForm.tsx`, `event-detail/EventAttendeesCard.tsx` (new),
`events/EventListCard.tsx`/`.test.tsx`, `EventCreatePage.tsx`,
`EventDetailPage.tsx`/`.test.tsx`, `EventEditPage.tsx`/`.test.tsx`,
`EventRequestsTab.tsx`, `EventsPage.tsx`/`.test.tsx`, `EventsSettingsTab.tsx`,
`events-settings/AttendanceSection.tsx` (new), `events-settings/index.ts`,
`services/eventServices.ts`, `types/event.ts`, `utils/eventHelpers.ts`.
(`pages/MinutesDetailPage.unlinkEvent.test.tsx` also changed in range but
belongs to the Meetings & Minutes feature, not this one — a test for that
page's own event-unlink button, not events-owned code.) Additionally
touched by this pass's fixes: `hooks/useRSVPForm.ts`,
`components/event-detail/EventCheckInModal.tsx`.

---

## Pass 2 (2026-08-28) — 3 fixes (1 HIGH cross-tenant, 2 MED DoS/ordering), 3 scope corrections, 2 stale-doc corrections

**PR:** [#1973](https://github.com/thegspiro/the-logbook/pull/1973) ·
**Scoped since pass 1's merge:** `c68a9bef` (PR #1848 — single merge, no
Codex-follow-up commit to re-scope against).

**Codex follow-up (same PR, same day): five P2 findings against this pass's
own first draft, all five confirmed real, none dismissed.** The first draft
of this section claimed "no new findings, two doc corrections" — that claim
was wrong, and the reason it was wrong is worth recording: pass 2 verified
each mechanism it re-read, but **it re-read the mechanisms pass 1 had named**
and did not go looking for the ones neither pass had. Two of the five are
scope gaps of exactly that shape (a basename-only frontend discovery command;
a changed backend file outside the declared list), and the other three are
defects sitting in code both passes had opened and read.

| ID      | Severity | Disposition | What                                                                                         |
| ------- | -------- | ----------- | -------------------------------------------------------------------------------------------- |
| EV-17   | HIGH     | ✅ FIXED    | Cross-tenant event-attachment read: client-authored `file_path` in generic create/update     |
| EV-18   | MED      | ✅ FIXED    | CAPTCHA provider verification ran before the per-IP limiter on `POST /event-requests/public` |
| EV-19   | MED      | ✅ FIXED    | Lead-time rejection spent the per-org daily cap, letting refused traffic exhaust it          |
| (scope) | —        | ✅ FIXED    | Frontend sweep missed `pages/events-settings/` and four generically-named files (54 → 74)    |
| (scope) | —        | ✅ FIXED    | `api/public/portal.py` changed since pass 1 and was outside the enumerated backend scope     |

Full write-ups below, under **Findings (pass 2)**.

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

### Frontend scope correction (two rounds: pass 1's gap, then this pass's own)

> **Correction (Codex review of this PR).** The "54 files" figure below and
> the sweep built on it were **both wrong**, for the reason Codex named: the
> discovery command was `find frontend/src -iname "*event*"`, and `-iname`
> matches the **basename** only. It therefore enumerated
> `pages/events-settings/` the directory and none of the nine files inside
> it — including `PipelineSection.tsx`, which renders the EV-5
> `accept_public_requests` opt-in this very pass claimed to have
> re-verified — and it missed every event file whose own name does not
> contain "event". Re-run correctly, the surface is **74 files**, not 54.
> The true scope, the true changed set, and a re-run sweep are recorded in
> **Frontend scope, corrected (74 files)** immediately after this
> subsection; the paragraphs directly below are pass 2's original text, kept
> because its diagnosis of _pass 1's_ gap stands and only its own replacement
> figure was short.

Pass 1 scoped its frontend check to `modules/events/` and read only the
cache-exclusion checklist item there. **`modules/events/` is a two-file
barrel** (`index.ts` + `routes.tsx`, route registration only) — the actual
events frontend lives in `pages/Event*.tsx`
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

### Frontend scope, corrected (74 files) — the figure that supersedes the 54 above

Rebuilt two independent ways and reconciled, rather than from one `find`:

1. **Path-recursive discovery** — `find frontend/src -ipath '*event*' -type f`
   (`-ipath`, not `-iname`: it matches the whole path, so a file inside an
   `events-settings/` directory counts). **70 files.**
2. **Import-graph closure** — a transitive walk of every `import` from the
   twelve route entry points in `modules/events/routes.tsx` plus
   `eventServices.ts`/`types/event.ts`/`eventHelpers.ts`/
   `useEventNotifications.ts`. 175 files reachable, of which all but four
   are either already in set (1) or shared app-wide infrastructure owned by
   another rotation feature (`components/ux/*`, `services/api.ts`,
   `stores/authStore.ts`, `utils/dateFormatting.ts`, …).

The four the graph adds and the name-based search could never find are
`components/CalendarView.tsx`, `components/RSVPStatusBadge.tsx`,
`hooks/useRSVPForm.ts` and `hooks/useOverrideAttendance.ts` — each imported
by exactly one file, `EventsPage.tsx` or `EventDetailPage.tsx`, so each is
events-owned despite its generic name. (`hooks/useCaptcha.ts`, which Codex
did not name but sits adjacent, is **not** events-owned: it is also imported
by `authService.ts`, `formsServices.ts`, `PublicFormPage.tsx` and
`ForgotPasswordPage.tsx`.) **70 + 4 = 74.**

**The 20 files pass 2's original sweep missed:** all nine of
`pages/events-settings/` (`CategoriesSection.tsx`, `EmailSection.tsx`,
`FormSection.tsx`, `HourTrackingSection.tsx`, `OutreachSection.tsx`,
`PipelineSection.tsx`, `VisibilitySection.tsx`, `index.ts`, `types.ts`),
`components/events/NeedsYouBand.tsx` (+ test),
`components/event-detail/TrainingSessionLinkageCard.tsx` (+ test),
`utils/eventUrgency.test.ts`, `e2e/events-urgency.spec.ts`, and the four
generically-named files above.

**Changed set is unaffected.** `git diff --name-only c68a9bef..a28d39e6` over
the corrected 74-file set returns the same three files (`EventForm.tsx`,
`EventForm.test.tsx`, `eventServices.ts`) — **none** of the 20 newly-found
files has changed since pass 1, so the "only two changed" conclusion above
survives the scope correction even though the scope statement did not.

**`PipelineSection.tsx` read in full (236 L), because pass 2 claimed to have
re-verified the EV-5 opt-in it renders.** It is purely presentational: every
value arrives as a prop and every change is a callback (`settings`,
`onToggleAcceptPublicRequests`, `onUpdateLeadTime`, …); it holds no state,
calls no API and enforces nothing. Persistence is `EventsSettingsTab.tsx`'s
`savePipeline` → `PATCH /events/settings`, whose
`RequestPipelineUpdate.accept_public_requests` field exists and round-trips
(asserted structurally by
`test_event_request_public_intake.py::TestRequestPipelineSettingsAreSettable`),
and enforcement is server-side in `submit_public_event_request`. So the
toggle is a display of a server-held switch, not a client-side gate — no
finding, and the EV-5 re-verification claim is now actually supported by
having read the UI it names. `FormSection.tsx` also read: its only outbound
behaviour is composing a same-origin share URL from `window.location.origin`
and copying it to the clipboard.

**Sweep re-run over all 74** — `window.confirm`/`alert`/`prompt`,
`dangerouslySetInnerHTML`, banned
`.toLocaleString`/`.toLocaleDateString`/`.toLocaleTimeString`, a `date-fns`
import, a direct `fetch(` call, and `localStorage` — zero hits on the first
five. `localStorage` appears three times, all benign and all already
sanctioned: `EventsPage.tsx` persists the user's own filter presets (no PII,
no credential), and `e2e/events-urgency.spec.ts` sets the documented
`has_session` flag and the theme preference. No token is stored anywhere in
the surface.

Still noted as partial-scope, not assumed fully read line-by-line: this
closes the _discovery_ gap for good (the surface is now identified two ways
that agree, and every file in it swept), but a first full line-by-line read
of the ~70 untouched files is still owed to a future pass, the same
disposition SCH-15 gave its own `pages/scheduling/` sweep.

### Backend scope correction — `api/public/portal.py` (Codex review of this PR)

Pass 2's "also checked, per the EC-14/SCH-15 lesson" list named six adjacent
files and missed a seventh. Codex's method found it and pass 2's did not:
searching the **changed** files in `c68a9bef..a28d39e6` for
`from app.models.event import` surfaces `backend/app/api/public/portal.py`
(+35/-5), whose `check_portal_enabled` gates `GET /public/v1/events` — an
**unauthenticated-session, API-key-authenticated public consumer of `Event`**
that changed in range and was never enumerated. Reviewed now, per
CHECKLIST.md dimensions 1 (authn/authz) and 2 (tenancy):

- The change **adds** a gate rather than relaxing one: `check_portal_enabled`
  now takes `db` and, after the existing `config.enabled` check, also
  requires `"public_info"` in the org's `enabled_modules`. The two switches
  were stored independently, so turning the module off under Settings →
  Modules left `config.enabled` true and this router kept serving to every
  issued API key. The module check has to live here because `require_module`
  resolves the org from a _session_ and this router authenticates with an
  API key.
- Both refusals return **503 with an identical detail**, so the pair is not
  an oracle for "switched off" vs "not licensed".
- Org resolution is unchanged and correct: `config` is fetched by
  `PublicPortalConfig.organization_id == str(api_key.organization_id)`, the
  new module lookup uses `config.organization_id` (the same value), and
  `get_public_events` filters `Event.organization_id == str(api_key.
organization_id)`. There is **no client-supplied organization id anywhere
  on this path**, so no enumeration of another org's events is reachable.
- The event projection is additionally narrowed by
  `event_type == PUBLIC_EDUCATION`, `is_cancelled is False`, a
  `is_draft is False/NULL` filter, `start_datetime >= now`, and finally
  `filter_data_by_whitelist(org, "events", …)`.

✅ Reviewed, clean, no finding. Recorded in scope so the "full backend event
surface" claim is true rather than approximately true.

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
  per-org daily cap (`daily_cap_exceeded`) — the four fronts
  `KNOWN_LIMITATIONS.md` credits it with, all four present. This closes a
  real documentation gap: EV-16 pass 1 is the first security-review pass over
  this feature and never verified or even cited EV-5's resolution.

  > **Correction (Codex review of this PR), twice over.** This bullet
  > originally described the ordering as "per-IP rate limit (10), then
  > org-exists-and-active, then the opt-in check … then the honeypot … then
  > the per-org daily cap, counted only after authorization and the honeypot
  > so rejected traffic can't exhaust a legitimate department's allowance."
  > Both ends of that sentence were false, and each is now its own finding:
  > the per-IP limit did **not** run first (EV-18 — it was a call in the
  > handler body, so FastAPI ran the `require_captcha` **dependency** ahead of
  > it), and the daily cap was **not** spent only by accepted traffic
  > (EV-19 — the lead-time rejection ran after the counter's atomic
  > `INCR`). Both are fixed in this PR; the enforcement order is now
  > `_rate_limit_public_request` → `require_captcha` → org active → opt-in →
  > honeypot → **lead time** → daily cap. The lesson: this bullet described
  > the _source order of the lines in the function body_, which for a FastAPI
  > handler is not the execution order, and the presence of a control is not
  > the same claim as its position.

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

> **Correction (Codex review of this PR)** to the JSON-column bullet above:
> re-checking the two `attachments` write sites for Pitfall #12 established
> only that the column's **dirty tracking** is correct — that a reassignment
> is seen by SQLAlchemy. It said nothing about where the values in it came
> from, and the values were client-authored. That is EV-17 below. Verifying
> a column is written _correctly_ is not verifying it is written with
> _trustworthy data_; the checklist item that catches the second one is
> tenancy (dimension 2 / pitfall #14c), not JSON discipline.

No regression in any pass-1 fix. Three new findings, all fixed in this PR:

## Findings (pass 2)

### EV-17 — HIGH — Cross-tenant event-attachment read via client-authored `file_path` — ✅ FIXED

**Reported by Codex on this PR; confirmed exploitable end-to-end before
fixing.** The four links in the chain, each read directly:

1. `EventBase.attachments`, `EventUpdate.attachments` and
   `RecurringEventCreate.attachments` are all
   `Optional[List[Dict[str, str]]]` — an **unconstrained** dict. There is no
   server-issued handle: `file_path` is a free string the client supplies.
2. `EventService.create_event` persists it via
   `Event(**event_data.model_dump())`; `update_event` and
   `update_future_events` via `setattr(event, field, value)` over
   `model_dump(exclude_unset=True)`; `create_recurring_event` via
   `Event(**event_data)` onto the parent _and every generated occurrence_.
   None of the four validated the path.
3. The real upload path writes to
   `/app/uploads/event-attachments/<organization_id>/<event_id>/<uuid><ext>`
   — org-segmented, and it always has been (`git log -S` finds no earlier
   org-less layout), so a stored path names its owning org in plain sight.
4. `download_event_attachment` resolved the stored path and required it to
   be under the **shared** `ATTACHMENT_UPLOAD_DIR` root. Every org's uploads
   are under that root, so the check stopped `../../etc/passwd` and passed
   `<root>/<other-org>/<their-event>/<their-file>.pdf`.

So: an `events.manage` holder in org A who obtains org B's stored path
(a leaked URL, a compromised low-privilege account in B, an operator
hand-off, a backup) `PATCH`es it onto an event in **their own** org and
downloads it through **their own** event. Every org-scoping query on the
path is correct and none of them helps — the row being read is legitimately
org A's; only the bytes it points at are not. Pitfall #14c, applied to a
filesystem path instead of an FK.

`delete_event_attachment` had the same root-only guard, i.e. the same shape
for a destructive operation. It is not equally reachable — the reference
count that gates the unlink is global, so the victim's own event still
referencing the file keeps it on disk — but the guard is now org-scoped
there too rather than relying on that.

**Fix.** New `app/utils/event_attachments.py` owns `ATTACHMENT_UPLOAD_DIR`
(so the service layer can reach it without importing the endpoint module)
plus `is_path_in_org` / `validate_attachments_for_org`, both failing closed
on a missing path or org. Applied at both ends, because either alone leaves
a hole — the write side would not protect rows already stored, and the read
side would not stop a foreign path being persisted and surfaced by
`GET /{event_id}/attachments`:

- **Write** — `validate_attachments_for_org` in `create_event`,
  `update_event`, `update_future_events` and `create_recurring_event`.
  `ValueError` → 400. Same-org copying stays legal, which it must:
  `duplicate_event` and recurring-occurrence generation both deliberately
  share a `file_path` across events.
- **Read** — `download_event_attachment` and `delete_event_attachment` now
  confine the resolved path to `<root>/<caller's org>/`, exactly mirroring
  the fix already made for documents (**DOC-24**, P1) in
  `api/v1/endpoints/documents.py`. That precedent is the strongest evidence
  this was a real bug and not a theoretical one: the identical defect was
  found, rated P1 and fixed in the documents module, and the events module
  was never given the same treatment.

**Not left as a `KNOWN_LIMITATIONS.md` entry** — it is fully fixed here.

**Guard test:** `tests/test_event_attachment_org_scoping.py` (12 cases) —
write side refuses a foreign path, a `..` escape out of the org subtree, a
path outside the upload root, a missing `file_path` and a non-object entry,
and accepts the caller's own path; read side returns **403** for a foreign
stored path and **404** (missing on disk) for the caller's own, which is
what distinguishes "the guard rejected it" from "the guard let it through";
service level asserts `update_event` raises before `commit` and
`create_recurring_event` returns the error without `add`.

**Collateral, fixed in the same commit:**
`test_event_lifecycle.py::test_duplicate_event` seeded
`attachments=[{"name": "agenda.pdf", "url": "/agenda.pdf"}]` — a shape with
no `file_path` at all, which nothing in the app writes and nothing reads
(the download endpoint indexes `attachment["file_path"]`; the frontend
`EventAttachment` type requires it). Replaced with the real shape under the
test org's own subtree, so the fixture now asserts something true.

### EV-18 — MED — CAPTCHA provider verification ran before the per-IP limiter — ✅ FIXED

**Reported by Codex on this PR; confirmed.** The route was
`dependencies=[Depends(require_captcha)]` with the per-IP check as the first
statement of the handler **body**:

```python
@router.post("/public", dependencies=[Depends(require_captcha)])
async def submit_public_event_request(...):
    allowed, _c, _l = await check_ip_rate_limit(client_ip, limit=10)
```

FastAPI resolves every declared dependency before it enters the handler, so
a body call can never precede one — the ordering is a property of _where the
check is declared_, not of where its line sits. With CAPTCHA configured,
`require_captcha` → `verify_captcha_token` makes an **outbound httpx POST to
the provider for every non-empty token** (it short-circuits only on an empty
one). One IP could therefore drive unbounded provider verifications, sockets
and `logger.warning` lines and never reach a throttle — the exact inversion
of CHECKLIST.md dimension 6, "public and unauthenticated surfaces are
rate-limited before the expensive work".

**Fix.** The limiter is now `_rate_limit_public_request`, a dependency
declared **first**:
`dependencies=[Depends(_rate_limit_public_request), Depends(require_captcha)]`.
This is not an invention — it is the pattern `api/public/forms.py` already
uses on `POST /{slug}/submit`
(`dependencies=[Depends(_rate_limit_submit), Depends(require_captcha)]`),
which had it right and which this endpoint diverged from.

**Guard test:**
`test_event_request_public_intake.py::TestPublicSubmitControlOrdering`
asserts against the live `APIRoute.dependencies` list that
`_rate_limit_public_request` is present **and** precedes `require_captcha`,
so moving the limiter back into the body fails rather than passing silently.

### EV-19 — MED — Refused traffic could exhaust the per-org daily cap — ✅ FIXED

**Reported by Codex on this PR; confirmed.** `daily_cap_exceeded` is an
atomic Redis `INCR` (`security_middleware.py:217`) that returns
`count > limit` — **asking the question spends a slot**. On
`POST /event-requests/public` it was called _before_ `lead_time_error`, so a
schema-valid submission naming a date inside the department's
`min_lead_time_days` incremented the counter and _then_ got its 400.

Distributed callers (the per-IP limiter caps one IP at 10, which is what the
daily cap exists to backstop) could post too-soon dates until the whole day's
allowance was gone, and the department's real public intake would answer
"not accepting further requests today" — a denial of exactly the service the
cap was added to protect. It also contradicts the contract stated in this
codebase's other intake path, whose comment reads _"Reserve daily capacity
only after the request has passed every rejection path"_
(`forms_service.py:1008`); the honeypot on this very endpoint was already
placed above the counter for the same reason, and the lead-time check —
added later — was not.

**Fix.** `lead_time_error` moved above `daily_cap_exceeded`, with the
invariant written down at the call site: every rejection path belongs above
the counter, because the counter is spent by being consulted.

**Guard test:**
`test_event_request_public_intake.py::TestRejectedTrafficCannotSpendTheDailyCap`
— a single too-soon submission is refused with the cap mock never awaited,
and a flood of `2 × limit` too-soon submissions leaves the counter untouched
while a subsequent well-dated request still reaches `db.add` and consults the
cap exactly once with the configured limit.

## Completion gate (pass 2)

| Check                                                                                   | Result                                                                               |
| --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `flake8 app/ tests/ alembic/`                                                           | ✅ 0 violations                                                                      |
| `black --check app/ tests/ alembic/`                                                    | ✅ 1323 files unchanged                                                              |
| `isort --check-only app/ tests/ alembic/` (isort 8.0.1, CI's pin)                       | ✅ clean                                                                             |
| `python3 scripts/validate_migrations.py --strict`                                       | ✅ single head, 389 revisions                                                        |
| `pytest tests/ -k "events or event_request or portal or attachment"`                    | ✅ 285 passed, 1 pre-existing skip                                                   |
| `pytest tests/ -k "event"` (broader net — most test files are `test_event_*`, singular) | ✅ 589 passed, 1 pre-existing skip                                                   |
| `pytest tests/` (full backend suite)                                                    | ✅ 9196 passed, 22 pre-existing skips, 0 failed (9181 + the 15 new guard cases)      |
| `tsc --noEmit`                                                                          | ✅ 0 errors                                                                          |
| `eslint .`                                                                              | ✅ 0 errors, 10 pre-existing warnings (same set as SEC-00/AP-13/EC-14/SCH-15 pass 2) |

Guard tests added on the Codex follow-up:
`tests/test_event_attachment_org_scoping.py` (EV-17, 12 cases) and two new
classes in `tests/test_event_request_public_intake.py` (EV-18
`TestPublicSubmitControlOrdering`, EV-19
`TestRejectedTrafficCannotSpendTheDailyCap`). The existing
`test_event_recurrence.py::TestCreateRecurringEventTemplateValidation`
(EV-11) and the full events/event-request suite continue to cover this
feature's previously-fixed classes.

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
