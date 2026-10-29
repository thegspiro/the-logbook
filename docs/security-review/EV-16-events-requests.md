# Security Review 16 — Events & Requests

**Prefix:** `EV` · **Iteration:** 16 · **Reviewed:** 2026-08-26 (pass 1),
2026-09-17 (pass 6), 2026-10-06 (pass 7), 2026-10-15 (pass 8), 2026-10-19
(pass 9), 2026-10-23 (pass 10), 2026-10-26 (pass 11), 2026-10-29 (pass 12) ·
**PR:**
[#1848](https://github.com/thegspiro/the-logbook/pull/1848) (pass 1),
[#2630](https://github.com/thegspiro/the-logbook/pull/2630) (pass 6),
[#2972](https://github.com/thegspiro/the-logbook/pull/2972) (pass 7, 0
fixed, EV-26 confirmed fixed),
[#3294](https://github.com/thegspiro/the-logbook/pull/3294) (pass 8, 0
fixed),
[#3438](https://github.com/thegspiro/the-logbook/pull/3438) (pass 9, 0
fixed),
[#3625](https://github.com/thegspiro/the-logbook/pull/3625) (pass 10, 0
fixed),
[#3748](https://github.com/thegspiro/the-logbook/pull/3748) (pass 11, 0
fixed, 0 flagged — new public guest-link surface reviewed clean),
[#3841](https://github.com/thegspiro/the-logbook/pull/3841) (pass 12,
watchdog pickup, 0 fixed, 0 flagged — two authorization-widening commits
reviewed clean against all seven checklist dimensions)

**Backend:** `api/v1/endpoints/events.py` (61 routes, unchanged — a large
in-route diff this pass widens who may reach nine existing attendance routes
and five existing admin routes, no new route),
`api/v1/endpoints/event_requests.py` (23 routes — includes the
public outreach event-request intake pipeline),
`api/v1/endpoints/event_attendance_petitions.py` (7 routes, unchanged),
`api/public/event_guest.py` (4 routes, unchanged, zero diff this pass),
`services/event_service.py`,
`services/event_request_service.py`,
`services/event_attendance_petition_service.py`,
`services/event_organizer_service.py`,
`services/guest_check_in_service.py`,
`services/qr_check_in_analytics.py` (zero diff this pass),
`models/event.py`, `models/event_request.py`
**Frontend:** `modules/events`, `pages/AttendanceRequestsPage.tsx`,
`pages/GuestCheckInPage.tsx` + `.test.tsx`, `components/GuestEmailSignIn.tsx`
**Migrations:** `b8236e29ec44` (repo-wide email-address encryption at rest,
touching `event_requests.contact_email` and
`event_external_attendees.email`/`.email_hash`) reviewed this pass — see
Pass 12 below

---

## EV-23 resolved (2026-10-11, owner decision)

Built as the owner chose — list every ahead-of-phase occurrence in the 409.
`POST /events/{id}/rsvp-series` takes `override`; a **going** series RSVP
evaluates `_evaluate_session_phase_warning` for every future occurrence
before writing, and raises `SeriesPhaseGateWarning`, which the endpoint turns
into 409 `phase_gate` with an `occurrences` list. `useRSVPForm`'s series
branch confirms against the list and retries with `override=true`. Tests:
`test_event_rsvp_waitlist.py::TestRsvpToSeries`,
`test_series_rsvp_phase_gate_endpoint.py`, `hooks/useRSVPForm.test.ts`.

---

## Pass 12 (2026-10-29) — real delta (8 real commits of 334 in scope), two authorization-widening commits reviewed clean, 0 fixes needed, 0 flagged

**Watchdog pickup.** The dedicated `/loop 30m /security-review` session
remains unreachable. Step 0 re-check: no PR's head branch starts with
`claude/security-review-` (`list_pull_requests`, state=open — the one open
PR, #3839, is unrelated layout work on branch `ccr-ba1682dc-g25b70`),
re-checked immediately before starting. PR #3840 (Feature 15, Scheduling,
pass 12) had already merged (`731396b9`). Row 16 (Events & requests)
confirmed the next `⬜` row by reading the Rotation table directly on a
freshly fetched `main`.

### Scope

Baseline `e8e0e075` (PR #3748's merge, pass 11). **334 non-merge commits**
landed repo-wide in the window; diffing every declared file individually:

- **Real diff:** `events.py` (+299/-33), `event_service.py` (+14),
  `event_request_service.py` (+27/-19), `guest_check_in_service.py`
  (+26/-2), `models/event.py` (+7/-3), `models/event_request.py` (+1/-1),
  `schemas/event.py` (additive fields, folded into the `events.py`-driven
  commits below), `frontend/src/modules/events/routes.tsx` (+3/-1),
  `frontend/src/components/EventForm.tsx`,
  `frontend/src/components/event-detail/EventRSVPSection.tsx`,
  `frontend/src/pages/EventDetailPage.tsx` + `.test.tsx`,
  `frontend/src/pages/EventEditPage.tsx` + `.test.tsx`,
  `frontend/src/pages/EventQRCodePage.tsx` + `.test.tsx`,
  `frontend/src/components/events/GuestCheckInQRCard.tsx` + `.test.tsx`,
  `frontend/src/types/event.ts`,
  `frontend/src/pages/EventCheckInMonitoringPage.tsx` (CLS loading-skeleton
  only, no behavior change).
- **Zero diff** (confirmed by `git diff --stat` returning nothing):
  `event_requests.py`, `event_attendance_petitions.py`,
  `api/public/event_guest.py`, `event_attendance_petition_service.py`,
  `event_organizer_service.py`, `qr_check_in_analytics.py`,
  `pages/AttendanceRequestsPage.tsx`, `components/GuestEmailSignIn.tsx`.

**No scope gap this pass.** `grep -c '^@router\.'` against all four backend
route files is unchanged from pass 11 (`events.py` 61, `event_requests.py`
23, `event_attendance_petitions.py` 7, `event_guest.py` 4 — 95 total), and
`git diff --name-status` against the full window turned up no new file
under `backend/app/api`, `backend/app/services`, `backend/app/models` or
`frontend/src` touching "event" beyond the fourteen files listed above as
real diff. Full-repo route count (`check_route_permissions.py --strict`,
below): 280, 0 errors.

### Real commits reviewed (8 of the 334, by declared-file diff)

- **`5764dafd` ("Let event organizers and training managers run event
  attendance")** — the main change of this window. Nine existing,
  previously `events.manage`-only routes (`GET /{id}/rsvps`,
  `GET /{id}/rsvp-history`, `GET /{id}/eligible-members`,
  `POST /{id}/check-in`, `POST /{id}/add-attendee`,
  `POST /{id}/bulk-add-attendees`, `PATCH /{id}/rsvps/{user_id}/override`,
  `DELETE /{id}/attendees/{user_id}`, `GET /{id}/stats`) now also admit the
  event's own organizer/alternate (any event type) and `training.manage`
  (Training events only), through a new `_authorize_attendance_manager`.
  Checked against every checklist dimension:
  - **Auth/authorization (§1/§2):** the dependency on all nine routes
    moved from `require_permission("events.manage")` to bare
    `get_current_user`, with `_authorize_attendance_manager` doing the
    gating inside the handler. This is exactly the shape checklist §2 warns
    about ("permissionless by dependency, handler decides") —
    `tests/permissionless_route_baseline.txt` is updated for all nine
    routes with a comment explaining the real gate, so the baseline test
    doesn't flag them as an unreviewed regression and the next reader sees
    why they're there. `events.manage` is checked and admitted **before any
    read** (unchanged behavior, matching the pre-existing `require_permission`
    shape exactly); every other caller is decided only against the event
    read org-scoped.
  - **Tenancy (§3, XC-3):** for the two new access paths (organizer,
    training manager), `_authorize_attendance_manager` fetches
    `Event.id == event_id AND Event.organization_id ==
user.organization_id` **before** calling `attendance_access`/
    `is_event_organizer`, so an organizer id or a training-manage grant on
    another department's event admits nobody (404, not 403 — no existence
    oracle). Confirmed by test
    (`test_event_organizer_attendance.py::TestWhoIsTurnedAway::
test_an_organizer_id_on_another_departments_event`). For the
    `events.manage` fast path, the function returns before any read (same
    as the route's pre-existing behavior), and every route still passes
    `organization_id=current_user.organization_id` — never a client-
    supplied value — to the service call beneath it, so tenancy for that
    path is unchanged from the already-reviewed baseline, not a regression.
  - **Separation of duties (§2):** `_refuse_own_attendance` blocks an
    organizer from checking themselves in, adding themselves, overriding
    their own times, or being added via bulk-add (reported per-row, not a
    blanket refusal, so "add everyone eligible" still adds everyone else) —
    the same "someone else vouches for you" rule attendance requests
    already follow. Deliberately **not** applied to a `training.manage`
    holder, who is an administrative grant-holder like `events.manage`, not
    a single named party on one event — consistent with the existing rule
    that `events.manage` was never subject to it either. Tested:
    `TestWhatTheOrganizerMayNotDo::test_cannot_record_their_own_attendance`.
  - **On a Training event**, an organizer may add/check-in/remove but may
    not correct times or credited hours (`may_correct_attendance_times`) —
    tested
    (`TestWhatTheOrganizerMayNotDo::test_cannot_correct_times_on_a_training_event`).
  - **Data exposure (§5):** off the `events.manage` path, the roster's
    email column is re-resolved through the same contact-visibility policy
    `get_eligible_members`/the directory already use
    (`load_contact_policy`), rather than the raw stored address — an
    organizer is just another member and should not see more than the
    directory shows. `EventRSVPSection.tsx` was updated to render the email
    conditionally (`{rsvp.user_email && ...}`) rather than assuming it is
    always present. Two new detail-endpoint-only response fields
    (`attendance_access`, `can_correct_attendance_times`) are per-caller,
    not serialized on the list endpoint (`_build_event_response(event)`
    with no extra kwargs at the one list call site, confirmed by grep),
    matching the existing `can_manage_organizers` pattern and Pitfall #29
    (the frontend reads these server-decided flags rather than
    re-deriving the gate — confirmed in `EventDetailPage.tsx`).
  - **Audit (Pitfall #33):** every write route's `log_audit_event` call now
    carries `acting_as` (one of `events_manager`/`training_manager`/
    `organizer`) — an id/enum, never free text.
  - **Tests:** `test_event_organizer_attendance.py` (new, ~30 cases
    spanning the organizer's own event, what they may not do, who is
    turned away including the cross-org case, the training-manager path,
    and the response flags) read in full rather than trusted from names.
- **`692b2832` ("Let training managers edit, close and reopen Training
  events")** — follow-up widening five more existing routes
  (`update_event`, `update_future_events`, `record_actual_times`,
  `finalize_attendance`, `reopen_attendance`, `end_event`) to also admit
  `training.manage` on a Training event, via a new `_authorize_event_admin`
  (the same org-scoped-fetch-before-permission-decision shape as above,
  confirmed by the same read).
  - **Scope containment is the interesting part of this commit**, and it
    holds: a training manager may not change `event_type` away from
    Training (`_refuse_type_change_off_training` — refused, because it
    would move the event out of their reach and theirs to add back), and a
    "this and all future" series edit refuses outright
    (`PermissionError` → 403) when **any** occurrence the update would
    reach is not Training —
    `EventService.update_future_events(only_event_type=)` checks this on
    the exact rows the method's own query locks for the update, so the
    check and the write agree on the same snapshot (no TOCTOU between
    "which rows are Training" and "which rows get written"). Tested:
    `test_training_manager_event_admin.py::TestEditingATrainingSeries::
test_refuses_a_series_holding_another_type`.
  - **Tenancy (§3):** `test_training_manager_event_admin.py::
TestEditingATrainingEvent::test_another_departments_event_is_not_found`
    confirms the same cross-org 404 shape as the attendance commit above.
  - **A training manager may reopen attendance they finalized themselves**
    — an explicit, documented department decision (no second-person check),
    not an oversight; `events.reopen_attendance` holders are unaffected
    (still admitted unconditionally, any event).
  - **Response/frontend:** `can_edit_event`/`can_reopen_attendance` follow
    the same detail-only, server-decided pattern as the attendance commit;
    `EventEditPage.tsx` locks the `event_type` field for a training-manager
    editor and the route guard widened to
    `requiredAnyPermission={['events.manage', 'training.manage']}` with the
    server re-checking `can_edit_event` regardless (defense in depth, not
    reliance on the client).
- **`9458cb31` ("Hide the guest QR code until check-in opens")** — not a
  vulnerability fix: the guest check-in QR code (already rate-limited,
  daily-capped and org-scoped — reviewed clean in pass 11) was visible to
  managers outside its check-in window, which is a photographable credential
  shown before it is meant to be usable. `GuestCheckInService.
guest_sign_in_state` is now the single definition both the public guest
  endpoints (which already refused outside the window) and the manager's
  QR card (which now hides the code outside it) read, closing a drift
  surface rather than introducing a new control.
- **`0a7e2a9e` ("Stop sending an email whose template is switched off")** —
  this feature's slice of a repo-wide fix: a department-switched-off email
  template stopped silently sending anyway. Its only touch in this
  feature's declared scope is `event_request_service.py`'s
  `send_request_notification`, now routed through
  `email_service._render_unless_switched_off` and skipping the send
  outright (`rendered is None`) rather than always sending. No
  auth/tenancy/injection surface; reviewed to confirm the message-building
  path still escapes/validates identically when it does send (unchanged).
- **`43c11090`/`b48d63f2` ("Match emails by fingerprint…" / "Encrypt email
  columns…")** — this feature's slice of a repo-wide PII-at-rest hardening:
  `EventExternalAttendee.email` and `EventRequest.contact_email` move from
  plain `String` to `EncryptedText` (migration `b8236e29ec44`, reviewed in
  full below). `EventExternalAttendee` gains `email_hash` (a keyed HMAC
  fingerprint); `EventRequest.contact_email` gets no fingerprint column,
  confirmed correct by grep — nothing in this feature's services or
  endpoints ever filters/joins/searches on `contact_email` (no `.like()`,
  `.ilike()`, or `==` comparison against it anywhere in `app/`). Where the
  application does match an attendee by email
  (`guest_check_in_service.py:214`), it now goes through
  `EventExternalAttendee.email_hash.in_(email_fingerprints(email))` rather
  than a plaintext comparison — confirmed by direct read, not assumed from
  the commit message.
- **`b4d9388a`/`530edfc1` ("Cap the refusals that list data…")** — pure
  disclosure-hygiene hardening, same cross-cutting `list_within_detail_limit`
  class already reviewed for other features' passes. This feature's touch
  is three `ValueError` messages in `event_request_service.py`
  (`validate_staffing_roles`, `resolve_outreach_signup_role`) that joined an
  org-/client-influenced list straight into the message — now capped with
  "and N more" instead of risking `safe_error_detail`'s 300-character
  truncation turning a useful 400 into a content-free 500-style message.
  Plain string concatenation, not a logger call, so Pitfall #33 doesn't
  apply; wording is unchanged whenever the list already fit.

### Migration reviewed in full: `b8236e29ec44` (email encryption at rest)

This feature's two tables, `event_requests` and `event_external_attendees`,
are two of the twenty-odd tables this repo-wide migration touches.
Independently re-verified rather than taken on another feature's pass:

- **`create_all`-only-table guard (Pitfall #26):** the migration's own
  `_has_table` check skips a table absent from the database it is run
  against; `event_requests` is one of the tables its own docstring names as
  exactly this case (no dedicated `CREATE TABLE` migration exists for it —
  confirmed by `grep -rl "event_requests" backend/alembic/versions/` finding
  only this encryption migration and no creation migration). This matters
  for CI's empty-database run (Pitfall #35): the table doesn't exist there,
  so the step correctly does nothing rather than raising
  `NoSuchTableError`.
- **Idempotent, key-gated:** `_is_ciphertext` prefix-checks before
  encrypting (so a second run doesn't double-encrypt), and `_require_key`
  refuses before any DDL if there are rows to encrypt and no
  `ENCRYPTION_KEY` is set.
- **No broken search:** confirmed above — neither newly-encrypted column is
  ever the target of a `.like()`/`.ilike()`/`==` in this feature's code, so
  the migration introduces no silently-broken query.
- **Fingerprint only where needed:** `event_external_attendees.email_hash`
  is added and populated (used by the one place that matches by email);
  `event_requests.contact_email` gets none, correctly, since nothing
  matches on it.
- **Single head:** confirmed below (`validate_migrations.py --strict`).

### Re-verified standing items

- **EV-23 — still resolved**, zero diff on `rsvp_to_series`/
  `_evaluate_session_phase_warning` this window.
- **EV-26 — still fixed, unregressed.** Zero diff on
  `location_service.py::check_overlapping_events` or its three call sites
  this window; `KNOWN_LIMITATIONS.md`'s EV-26 entry still correctly
  documents the accepted cross-department residual.
- **`check_request_status`'s 256-bit token, still unrate-limited by
  design** — unchanged.
- **`ondelete="SET NULL"` nullability** — no new FK this window (the only
  model changes are the email-encryption column-type swap and the new
  `email_hash` column, neither a FK); the 8 existing `SET NULL` FKs across
  both model files are unchanged.
- **No new `.like()`/`.ilike()` beyond what's addressed above, no new CSV
  export.**

### Route inventory

**`events.py`: 61, unchanged.** This pass's +299/-33 diff is entirely
inside nine existing attendance routes and five existing admin routes
gaining a second/third admission path (organizer, training manager) — no
`@router` decorator was added or removed, confirmed by
`git diff e8e0e075..HEAD -- events.py | grep '^[+-]@router'` returning
nothing. **`event_requests.py`: 23, unchanged. `event_attendance_petitions.py`:
7, unchanged. `api/public/event_guest.py`: 4, unchanged** — zero `@router`
diff lines in any of the three. Full-repo route count
(`check_route_permissions.py --strict`, see completion gate): 280, up from
279 at pass 11 (unrelated routes from other features' concurrent work in
the same 334-commit window — none of the +1 is this feature's).

All three frontend route registries unchanged for this feature (no new
page); `check_route_permissions.py --strict` (below) confirms 0
errors/warnings against the current 280-route count.

### Verified good ✅ (pass 12)

- Both authorization-widening commits (organizer/training-manager
  attendance access; training-manager event administration) are clean on
  every checklist dimension: tenancy is decided against an org-scoped
  fetch before any new access path is granted (never the `events.manage`
  fast path's pre-existing behavior, which is unchanged), separation of
  duties is enforced for the organizer path specifically (and deliberately
  not for the two administrative-grant paths, consistent with how
  `events.manage` always worked), the series-edit type-lock is checked on
  the exact rows the update locks (no TOCTOU), response flags are
  detail-endpoint-only and server-decided (Pitfall #29), and
  `tests/permissionless_route_baseline.txt` carries a dated, reasoned
  comment for every route whose dependency moved from `require_permission`
  to a handler-side check.
- The guest-QR visibility fix and the switched-off-template fix are both
  centralize-one-definition refactors, not new attack surface.
- The repo-wide email-encryption migration's touch on this feature's two
  tables is independently re-verified: `create_all`-tolerant, idempotent,
  key-gated, fingerprinted only where a lookup needs it, and introduces no
  broken search.
- No new unbounded query, no new CSV export, no new seeded-grant change, no
  JSON-column shallow-copy mutation, no new client-supplied FK accepted
  without an in-org check, no new route (enumerated above).

### Completion gate (pass 12)

| Check                                                                   | Result                                                              |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `flake8 app/ tests/ alembic/` (7.4.1)                                   | ✅ 0 violations                                                     |
| `black --check app/ tests/ alembic/` (26.10.1, pinned `/usr/local/bin`) | ✅ clean, 2743 files unchanged                                      |
| `isort --check-only app/ tests/ alembic/` (9.0.2)                       | ✅ clean                                                            |
| `python3 scripts/validate_migrations.py --strict`                       | ✅ single head `f90b1124e6f4`, 678 revisions                        |
| `python3 scripts/check_route_permissions.py --strict`                   | ✅ 280 routes, 0 errors, 0 warnings                                 |
| `python3.13 scripts/generate_schema_docs.py --check`                    | ✅ up to date                                                       |
| `python3.13 -m pytest tests/ -k "event or guest or rsvp or attendance"` | ✅ 2137 passed, 1 pre-existing skip (`pywebpush`), 24463 deselected |
| `npm run typecheck`                                                     | ✅ 0 errors                                                         |
| `npm run lint` (`eslint --max-warnings 10`)                             | ✅ 0 errors, 0 warnings                                             |

**Environment note:** this sandbox's `python3` resolves to 3.11 with no
project dependencies installed; `python3.13` has them and is what every
Python row above used, per the skill's rule rather than silently using
whichever binary happened to work. `npm ci` was run fresh from the repo
root against the committed lockfile and completed clean.

Rotation row 16 → ✅ (pending this PR's merge). Next: Feature 17 (Training
core) — re-check `list_pull_requests`/`search_pull_requests` fresh rather
than trusting this note.

---

## Pass 11 (2026-10-26) — real delta (9 real commits of 202 in scope), new public surface reviewed clean, 0 fixes needed, 0 flagged

**Watchdog pickup.** The dedicated loop session
(`session_011T1ZyyLrD5HagusgK9uDw2`) was unreachable. Step 0 re-check: no
PR's head branch starts with `claude/security-review-`
(`search_pull_requests`, `is:pr is:open head:claude/security-review-`, 0
results) — re-checked immediately before starting and again immediately
before pushing. PR #3744 (Feature 15, Scheduling, pass 11) had already
merged (`1157a464`, the fetched `origin/main` tip). Row 16 (Events &
requests) was confirmed the next `⬜` by reading the rotation table
directly on that freshly fetched `main`.

### Scope

Baseline `31f24bf7` (pass 10's own commit, merged via PR #3625 — confirmed
`git merge-base --is-ancestor 31f24bf7 HEAD`; PR #3625 landed without a
distinct merge commit, so `31f24bf7` itself is the ancestor to diff from).
**202 non-merge commits** landed repo-wide in the window; diffing every
declared file individually:

- **Real diff:** `events.py` (+196/-4), `models/event.py` (+12/-1),
  `models/event_request.py` (+5/-2), `schemas/event.py` (+81/-6),
  `frontend/src/modules/events/routes.tsx` (+12).
- **Zero diff** (confirmed by `git diff --stat` returning nothing):
  `event_requests.py`, `event_attendance_petitions.py`,
  `event_service.py`, `event_request_service.py`,
  `event_attendance_petition_service.py`, `event_organizer_service.py`,
  `pages/AttendanceRequestsPage.tsx`.

**Scope gap found and closed, same shape as pass 7's.** `git diff
--stat` on the declared file list alone would have missed an entirely new
public, unauthenticated endpoint file this window added:
`backend/app/api/public/event_guest.py` (417 lines, 4 routes) plus its
backing service additions in `guest_check_in_service.py` (+364/-? — a file
that was read in earlier passes as a _callee_ but never added to this
file's declared scope) and two new frontend files,
`components/GuestEmailSignIn.tsx` (241 lines, new) and
`pages/GuestCheckInPage.tsx` (+94/-? — extended, not new). Also found:
`services/qr_check_in_analytics.py` (143 lines, new), reached from
`events.py`'s `qr-check-in-data`/`self-check-in` routes. All four are now
added to this feature's declared scope header above, so a future pass
diffs them rather than silently skipping them the way pass 6/7's
near-miss on the petition files warned against repeating.

### Real commits reviewed (9 of the 202, by declared-file + scope-gap diff)

- **`b5a6fbf1` ("Give public events their own guest check-in QR code") —
  the main feature of this window.** Adds `Event.guest_check_in_token`
  (256-bit, `secrets.token_urlsafe(32)`, unique+indexed+nullable — matches
  this feature's existing token-scoped-route pattern exactly), three
  `events.manage`-gated endpoints to issue/get/rotate it
  (`events.py:2777-2863`), and the new public router
  `api/public/event_guest.py` with four routes
  (`GET /{token}/guest`, `POST /{token}/guest-check-in`,
  `POST /{token}/guest-lookup`, `POST /{token}/guest-confirm`) that reuse —
  not reimplement — the kiosk guest path's own rate limiters
  (`_rate_limit_display`/`_rate_limit_guest_check_in`/
  `_rate_limit_guest_lookup`, all per-IP with a 10-minute lockout on the
  write paths), window/email-first gates
  (`_assert_guest_sign_in_open`/`_require_email_first`), and per-event
  daily ceiling (`daily_cap_exceeded`, keyed `guest_checkin:{event.id}` /
  `guest_lookup:{event.id}` — the **same** key the room-kiosk path spends,
  so alternating between a room code and an event's own link buys no
  extra allowance). Checked against every checklist dimension:
  - **Auth (§1):** every route in the new file carries only `get_db` — no
    `current_user` — by design: the path token is the sole credential and
    is checked first in `_resolve_link_event`, which is read in full
    (`guest_check_in_service.py:758`) and confirmed to answer the
    identical 404 for a malformed token (regex-checked before the query
    runs), an unknown one, a cancelled/draft event, and one whose
    `allow_guest_check_in` has since been switched off — no oracle for
    which case applies. The three manager-side issue/get/rotate routes in
    `events.py` are gated `require_permission("events.manage")`, not the
    broader `events.view` the member-facing QR page uses — correct per
    checklist §2 (the token is a credential for an unauthenticated
    _write_, so it warrants the stricter gate), and confirmed by test
    (`test_event_guest_link.py::TestManagerEndpointsArePermissionGated`).
  - **Tenancy (§3, XC-3):** `_event_for_guest_link` (the issue/get/rotate
    helper) and `issue_link_token` both filter
    `Event.id == event_id AND Event.organization_id == organization_id`
    — org-scoped by-id, not merely gated by `require_permission`. The
    public side has no `organization_id` in the request at all; the
    token alone resolves the event and, through it, the org — the
    correct shape for an anonymous credential-scoped route, matching
    `check_request_status`'s existing 256-bit-token pattern this file has
    reviewed every pass since pass 1. Confirmed by test
    (`test_event_guest_link.py::TestManagerEndpoints::
test_another_departments_event_is_a_404`): issuing/reading/rotating
    another org's event's link 404s, not 403 (no existence oracle).
  - **Data exposure (§5):** `guest_check_in_token` is never on
    `EventResponse` — confirmed both by direct read of `schemas/event.py`
    and by a dedicated test
    (`test_event_guest_link.py::TestManagerEndpoints::
test_event_detail_never_carries_the_token`) asserting the field is absent
    from `EventResponse.model_fields`, so no member below `events.manage`
    can read the credential off the ordinary event-detail endpoint.
  - **Abuse resistance (§6):** per-IP rate limits (10/min + 10-min lockout
    on every write route, 60/min on the read-only info route) plus the
    per-event daily cap, in that order — honeypot first (a bot gets a
    plausible-success response with no daily-cap spend), then every
    rejection gate, then the cap increment, then the write — the same
    "refuse before spending the cap" ordering EV-18/EV-19 established for
    the public event-request intake path. `daily_cap_exceeded` fails
    _open_ on a Redis outage (per-IP limiting still applies), matching
    this repo's documented Attack Protection fail-open/closed split for an
    availability-tier gate, not an auth one.
  - **Injection/output (§4):** no raw SQL, no `.like()`/`.ilike()`. The
    confirm-token mechanism (`issue_confirm_token`/`read_confirm_token`,
    `guest_check_in_service.py:539`) is a signed, 10-minute JWT scoped to
    `{type, prospect_id, event_id, location_id, organization_id}` —
    `location_id=""` for the event-link channel specifically so a token
    issued at a room kiosk cannot be replayed through an event's own link
    and vice versa (tested:
    `TestConfirmTokenChannels::test_kiosk_token_is_refused_through_the_link`/
    `test_link_token_is_refused_at_a_kiosk`). The frontend
    (`GuestCheckInPage.tsx`, `GuestEmailSignIn.tsx`) renders every
    server-supplied string (event name, message, display name) through
    plain JSX interpolation — no `dangerouslySetInnerHTML` anywhere in
    either file, confirmed by grep.
  - **Logging (Pitfall #33):** audit events
    (`event_guest_checkin`/`event_guest_lookup`) carry `event_id`,
    `attendee_id`/`prospect_id`, `location_id`, `source` — never the
    guest's email or name. A dedicated test class,
    `TestTokenRedaction`, asserts the guest-link token itself is redacted
    wherever it could appear in a log line (page path, API path, route
    parameter).
  - **Schema/migration (§7):** `b7e4c2a91d35` is additive and nullable,
    guards `_has_table`/`_has_column`/`_has_index` for the
    `create_all`-built-table case (Pitfall #26), and its own docstring
    confirms the unique index holds on a populated table because every
    pre-upgrade row is NULL (MySQL unique indexes admit any number of
    NULLs). No FK, so no `ondelete`/`nullable` pairing question applies.
  - **Idempotency (Pitfall #36):** a repeat sign-in through the same
    link token is a no-op attendance-wise —
    `_find_existing_attendee` matches on `(event_id, organization_id,
email-or-name)` before deciding whether to insert, and
    `test_repeat_sign_in_is_one_attendee` proves it against a real
    database (two POSTs, one row). Not a webhook/scheduled-task shape, so
    the rest of Pitfall #36 doesn't apply.
  - **Tests:** `test_event_guest_link.py` (new, 20+ cases spanning unit —
    token shape, cross-channel confirm-token refusal, log redaction,
    permission-gate enumeration — and integration — manager endpoints
    including the cross-org 404, and public sign-in including the
    unavailable-event 404-oracle check, the repeat-sign-in idempotency
    check, and the rotated-code-is-a-404 revocation check), all read in
    full rather than trusted from their names.
- **`dd034161` ("Sign in recruitment-event guests by email, recognising
  active applicants")** — the companion email-first flow for an event
  that also opts into the pipeline (`guest_check_in_creates_prospect`).
  Adds `guest-lookup`/`guest-confirm` to **both** the kiosk path
  (`display.py`, Locations' own rotation slot) and this feature's new
  event-link path, sharing one implementation
  (`GuestCheckInService.lookup_guest`/`issue_confirm_token`/
  `read_confirm_token`/`check_in_known_prospect`, all read in full —
  see above). `lookup_guest` checks an **active** applicant first, then
  an active member account, else not-found — matching `_link_prospect`'s
  own reuse rule, so a withdrawn/rejected applicant cannot be reopened
  from an anonymous tablet or link. The lookup is audited by outcome and
  prospect id, never the typed email (checklist §5/Pitfall #33).
  `check_in_known_prospect` re-verifies the prospect is still
  `ProspectStatus.ACTIVE` and in the caller's org at confirm time rather
  than trusting the lookup's answer from a minute earlier — closes the
  TOCTOU window where staff could withdraw an applicant between lookup
  and confirm. `GuestLookupResponse`/`GuestConfirmRequest` in
  `schemas/event.py` carry no extra PII (status + first-name-and-last-
  initial `display_name` + a token only).
- **`890c31aa` ("Let staff sign walk-in guests in from the event page")**
  — reuses the existing, already-gated `events.manage` external-attendee
  endpoints (`check_in_external_attendee`, confirmed via
  `git diff ... | grep '^[+-]@router'` showing zero route-decorator
  lines changed by this commit — no new route). Adds
  `open_prospect_for_staff_entry` (`guest_check_in_service.py:650`),
  which follows the same active-applicant-or-member-or-open lookup rule
  as the kiosk/link paths, org-scoped throughout (`organization_id`
  passed from the already-authenticated `current_user`, never
  client-supplied). `ExternalAttendeeCheckInResponse` gained an optional
  `prospect_id` field — additive, no existing consumer broken.
- **`952c3a56` ("QR check-in analytics: record scans and outcomes on the
  server")** — new `qr_check_in_analytics.py`, read in full. Both writers
  (`record_qr_scan`/`record_check_in_outcome`) take
  `organization_id`/`event_id`/`user_id` from already-org-verified
  request state (the event was already fetched org-scoped by
  `get_qr_check_in_data`/`self_check_in` before either writer is called;
  `user_id` is always `current_user.id`, never client-supplied) — no new
  IDOR surface. Failure reasons are mapped through a fixed allowlist
  (`FAILURE_REASONS`, 4 values) rather than storing the service's raw
  error string, so an unrecognised message is dropped rather than leaking
  free text into the analytics dashboard (checklist §5). No PII (name,
  email) is ever written to `AnalyticsEvent.event_metadata`.
- **`0b18dc3f`/`dd4ba98a`** ("fix(api): limit reminder lead times to 30
  days" / "bound request fields whose range their meaning fixes") — pure
  input-validation hardening via the new shared
  `schemas/reminder_limits.py` (`ReminderLeadDays`/`ReminderLeadHours`,
  `ge=0`) and `le=INT32_MAX` added to `min_lead_time_days`/
  `public_daily_limit`/`check_in_minutes_before`/`_after`. Closes an
  unbounded-integer-into-date-arithmetic `OverflowError` path (a 500,
  not a security boundary) with a 422. No tenancy/auth surface.
- **`fde3d647` ("Encrypt personal phone numbers and addresses at rest")**
  — this feature's slice of a repo-wide hardening migration
  (`5510d5ff49eb`): `EventRequest.contact_phone`/`venue_address` and
  `EventExternalAttendee.phone` move from plain `String`/`Text` to
  `EncryptedText` (AES-256-GCM). Migration reviewed in full: guards
  `_present_columns` for the `create_all`-only-table case (`event_requests`
  is one of the four tables named in its own docstring as exactly this
  case), requires `ENCRYPTION_KEY` before writing ciphertext
  (`_require_key`), is idempotent both ways (`_is_ciphertext` prefix
  check — a value already encrypted is not re-encrypted, a value not
  ciphertext is not "decrypted" on downgrade), and is itself the join
  point for two Alembic heads that branched from the same parent as
  `b7e4c2a91d35` (confirmed `validate_migrations.py --strict` finds a
  single head afterward — see completion gate). Confirmed no
  `.like()`/`.ilike()` anywhere in this feature's files touches either
  newly-encrypted column (grep), so the encryption introduces no broken
  search path (the migration's own docstring independently confirms this
  for the two columns elsewhere in the repo that _are_ searched and were
  deliberately left plain).
- **`91204bfc`/`afff97c4`** — pure Alembic-chain housekeeping
  (re-parenting then joining `b7e4c2a91d35` and a same-day, unrelated
  forms commit's `0a8d11fcada1` onto one head). No application-code
  change; reviewed only to confirm the join is sound (see completion
  gate's single-head result).

### Re-verified standing items

- **EV-23 — still resolved**, zero diff on `rsvp_to_series`/
  `_evaluate_session_phase_warning` this window.
- **EV-26 — still fixed, unregressed.** Zero diff on
  `location_service.py::check_overlapping_events` or its three call
  sites this window.
- **`check_request_status`'s 256-bit token, still unrate-limited by
  design** — unchanged; the new guest-link token follows the identical
  reasoning (possession of a 256-bit token is the credential; a
  per-token rate limit would not improve on brute-force infeasibility,
  and the _write_ routes behind it do carry per-IP limits regardless).
- **`ondelete="SET NULL"` nullability** — the one model change this
  window (`guest_check_in_token`) is not a FK, so no new pairing to
  check; the 8 existing `SET NULL` FKs across both model files are
  unchanged (zero diff beyond the new column).
- **No new `.like()`/`.ilike()`, no new CSV export** (`import_events_csv`
  remains an import, unchanged this window).

### Route inventory

**`events.py`: 61 routes, up from 58** — the three new
`guest-check-in-link` routes (issue/get/rotate), confirmed via
`git diff 31f24bf7..HEAD -- events.py | grep '^\+@router'` showing
exactly these three, and independently via `grep -c '^@router\.'` (58 →
61). **`event_requests.py`: 23, unchanged. `event_attendance_petitions.py`:
7, unchanged** — zero `@router` decorator diff lines in either file.
**`api/public/event_guest.py`: 4 routes, new file** — `grep -c
'^@router\.'` confirms. Full-repo route count (`check_route_permissions.py
--strict`, see completion gate): 279, up from 273 at pass 10 (the +6 here
plus unrelated routes from other features' concurrent work in the same
202-commit window).

**All three frontend route registries updated for the new public page**
(`APPLICATION_PAGES.md:21` and `:324`, `testingRegistry.ts:156`,
`mobile-route-inventory.ts:334` — `/event-guest/:token` →
`GuestCheckInPage`), confirmed present by direct grep before this pass
touched anything; `check_route_permissions.py --strict` (below) confirms
0 errors against the current 279-route count, so Pitfall #30a's three
registries agree.

### Verified good ✅ (pass 11)

- The new public guest-link surface (`event_guest.py`, 4 routes) is clean
  on every one of the seven checklist dimensions, detailed above: no
  auth gap (the token is the credential, checked first, fails closed and
  404-only), no cross-tenant read/write (XC-3; the token alone resolves
  org, confirmed by a dedicated cross-org test), no data exposure (the
  token itself is never serialized to a member below `events.manage`,
  tested), no injection/XSS (no raw SQL, no `dangerouslySetInnerHTML`),
  sound abuse resistance (reused per-IP + per-event-daily-cap gates,
  correct honeypot/rejection/cap-spend ordering), clean schema/migration
  (additive, nullable, `create_all`-guarded), and idempotent on repeat
  sign-in (tested against a real database).
- The companion email-first lookup/confirm flow re-verifies an applicant's
  **active** status at confirm time, not just at lookup time (TOCTOU
  closed), and never logs or displays more than a first name + last
  initial to the anonymous caller.
- The repo-wide phone/address encryption migration's touch on this
  feature's two tables (`event_requests`, `event_external_attendees`) is
  reviewed in full: guarded for the `create_all`-only-table case, requires
  the encryption key before writing ciphertext, idempotent in both
  directions, and introduces no broken `LIKE` search (none existed on
  either newly-encrypted column).
- No new unbounded query, no new CSV export, no new seeded-grant change,
  no JSON-column shallow-copy mutation, no new client-supplied FK
  accepted without an in-org check.
- Four files genuinely in this feature's dependency graph
  (`api/public/event_guest.py`, `services/guest_check_in_service.py`,
  `services/qr_check_in_analytics.py`,
  `components/GuestEmailSignIn.tsx`) were outside the declared scope
  header before this pass; all four are now read in full and added to it.

### Completion gate (pass 11)

| Check                                                     | Result                                                              |
| --------------------------------------------------------- | ------------------------------------------------------------------- |
| `flake8 app/ tests/ alembic/` (7.4.1)                     | ✅ 0 violations                                                     |
| `black --check app/ tests/ alembic/` (26.10.1)            | ✅ clean, 2676 files unchanged                                      |
| `isort --check-only app/ tests/ alembic/` (9.0.2)         | ✅ clean                                                            |
| `python3 scripts/validate_migrations.py --strict`         | ✅ single head `1ad0b594f3fb`, 658 revisions                        |
| `python3 scripts/check_route_permissions.py --strict`     | ✅ 279 routes, 0 errors, 0 warnings                                 |
| `python3.13 -m pytest tests/ -k "event or guest or rsvp"` | ✅ 1829 passed, 1 pre-existing skip (`pywebpush`), 23811 deselected |
| `npm run typecheck`                                       | ✅ 0 errors                                                         |
| `npm run lint` (`eslint --max-warnings 10`)               | ✅ see note below                                                   |

**Environment note:** this sandbox's `python3` resolves to 3.11 with no
project dependencies installed; `python3.13` (the interpreter `pip` here
actually installs into) has them and is what the test row above used —
flagged explicitly per the skill's rule rather than silently using
whichever binary happened to work. `npm ci` was run fresh from the repo
root (no `node_modules` pre-existed in this sandbox) and completed clean
against the committed lockfile.

Rotation row 16 → ✅ (pending this PR's merge). Next: Feature 17 (Training
core).

---

## Pass 10 (2026-10-23) — near-zero delta (7 of 379 commits in scope), 0 fixes needed, 0 new findings

**Watchdog pickup.** No open PR's head branch starts with
`claude/security-review-` (`search_pull_requests`, 0 results, checked after
PR #3617 — Feature 15, Scheduling, pass 10 — merged), and the dedicated loop
session (`session_011T1ZyyLrD5HagusgK9uDw2`) was not reachable (`ListAgents`,
checked twice). Rotation row 16 (Events & requests) was confirmed the next
`⬜` by reading the rotation table directly on a freshly fetched `main`.

### Scope

Baseline `8da1eb88` (PR #3438's merge, pass 9). **379 non-merge commits**
landed repo-wide in the window; only **7** touch this feature's declared
files — confirmed via `git log 8da1eb88..HEAD --no-merges -- <declared
files>`. `event_organizer_service.py`, `event_request_service.py`,
`event_attendance_petition_service.py`, `event_attendance_petitions.py`,
`models/event.py`, `models/event_request.py`, and the frontend
`modules/events` tree have zero diff since pass 9 — confirmed by the same
command against each path.

### Commits reviewed

- **`efd6eb83`** ("app-review B17 — a null on a required field answered 500
  in four update paths") — `update_event`, `update_template`,
  `update_email_template`, and `update_external_attendee` moved from a bare
  `setattr` loop to `apply_updates`/`reject_null_for_required`. This is the
  exact Pitfall #1 mirror-image correction CLAUDE.md asks for: an explicit
  `null` against a `NOT NULL` column now gets a 400 instead of a 500 or a
  stored JSON `null`; nullable fields still clear. No tenancy/auth surface —
  every touched row was already resolved through its existing org-scoped
  lookup before this commit, unchanged here.
- **`b92da7f3`** ("Storage: route every stored-file read, check and delete
  through one interface") — `events.py`'s attachment download/delete moved
  from a hand-rolled `is_path_in_org` + `os.path.realpath`/`os.remove` check
  to the shared `file_storage.resolve(file_path, organization_id,
StorageArea.EVENT_ATTACHMENTS)` / `.exists()` / `.file_response()` /
  `.delete_quietly()`. Read `resolve()` in full
  (`app/services/file_storage_service.py:200`): it fails closed on a
  non-string path, a missing org, and anything whose real path does not sit
  under `<UPLOADS_ROOT>/<org>/event-attachments/` (or the area's legacy
  root) — `..` and symlinks included, since the comparison is on
  `os.path.realpath`. Confirmed `delete_quietly(None)` is a no-op
  (`file_storage_service.py:1004`), so the delete path's unconditional call
  with a possibly-`None` resolve result cannot touch an unintended file. Same
  security boundary as before, now centralized instead of
  module-local — a hardening, not a regression.
- **`619d5e46`** ("Make check-out work on the event check-in page") — the QR
  check-in data endpoint now also returns the **scanning member's own**
  check-in/check-out times, read via `EventRSVP` filtered on `event_id`,
  `user_id == current_user.id`, and `organization_id` — self-scoped per
  checklist item 2, not a client-supplied id. The endpoint itself is
  authenticated (`current_user` dependency), not token-scoped public.
- **`82c82bda`** ("Pass a series on when its first occurrence is deleted;
  add 'this and future' delete") — the largest commit in scope. New
  `_lock_series()` row-locks the parent and every occurrence
  (`organization_id`-filtered, `with_for_update()`, Pitfall #27 shape) before
  any series mutation. The new `from_event_id` parameter on
  `DELETE /events/{id}/series` is validated as XC-1 requires: it's looked up
  only inside the already org-scoped `series` list
  (`next((e for e in series if str(e.id) == str(from_event_id)), None)`), so
  a cross-org or nonexistent id raises `ValueError("That occurrence is not
part of this series")` rather than being trusted. Attendance-finalization
  locking is preserved — only occurrences actually being deleted are checked,
  matching the existing "refuse the whole batch" discipline this file's
  pass-8/9 history already established.
- **`af733a1e`** ("check in from the event page, and keep the display QR
  code for whoever runs the event") — `_may_view_attendees()` is now one
  helper shared by `get_event`'s `can_view_attendees` field and
  `list_event_attendees`'s own 403 gate, closing the drift risk the two
  independent checks previously carried. "View QR Code" is now
  frontend-gated to `canManage || canManageOrganizers`
  (`EventDetailPage.tsx`) — cosmetic, not a new security boundary, since the
  underlying `GET /{event_id}/qr-check-in-data` (reviewed in pass 9) already
  returns only event metadata, never PII or a credential.
- **`8a57d069`** (repo-wide Pitfall #32 sweep) — `get_eligible_members`'s
  `User.status == UserStatus.ACTIVE` became
  `User.status.in_(ACTIVE_ACCOUNT_STATUSES)`; the existing
  `organization_id`/`deleted_at` filters are unchanged. Matches the
  established, test-enforced (`test_account_status_gates.py`) pattern.
- **`7a439ddb`** ("Shift series RSVP deadlines per occurrence") — pure
  date/timezone arithmetic (`rsvp_deadline_lead`/`rsvp_deadline_at`), no new
  query, no auth/tenancy surface. The schema changes in this commit
  (`schemas/inventory.py`, `schemas/training_enhancements.py`) are outside
  this feature's declared scope.

### Route inventory

**Unchanged: `events.py` 58, `event_requests.py` 23,
`event_attendance_petitions.py` 7** — confirmed via `grep -c '^@router\.'`
on each file; none of this window's 7 in-scope commits adds a route
decorator.

### Re-verified standing items

- EV-26, EV-23, the 256-bit `check_request_status` token, and the
  `ondelete="SET NULL"` nullability sweep — zero diff on the files each
  depends on this window; same conclusion as pass 9.
- EV-11's `create_recurring_event` `template_id` org-check — zero diff,
  unchanged.

### Verified good ✅ (pass 10)

- No new unbounded query, no new CSV export, no new `.like()`/`.ilike()`
  usage, no new JSON-column shallow-copy mutation, no new unauthenticated
  route, no new client-supplied FK accepted without an in-org check (the one
  new client-supplied id this window, `from_event_id`, is validated as
  described above).
- The storage-layer refactor (`b92da7f3`) preserves the exact same
  org/area confinement this file relied on before, now shared with 18 other
  modules instead of duplicated.

### Completion gate

| Check                                                    | Result                                                                                                                                                                                                                                                                                                                                                                                     |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `flake8 app/ tests/ alembic/` (pinned 7.3.0)             | ✅ 0 violations                                                                                                                                                                                                                                                                                                                                                                            |
| `black --check app/ tests/ alembic/` (pinned 26.5.1)     | ✅ clean, 2584 files unchanged                                                                                                                                                                                                                                                                                                                                                             |
| `isort --check-only app/ tests/ alembic/` (pinned 9.0.1) | ✅ clean                                                                                                                                                                                                                                                                                                                                                                                   |
| `python3 scripts/validate_migrations.py --strict`        | ✅ single head `4250eb8b8378`, 643 revisions                                                                                                                                                                                                                                                                                                                                               |
| `python3 scripts/check_route_permissions.py --strict`    | ✅ 273 routes, 0 errors, 0 warnings                                                                                                                                                                                                                                                                                                                                                        |
| `pytest tests/ -k "event"`                               | ⚠️ not run — this sandbox's Python dependencies were not pre-installed and a full `pip install -r requirements.txt` exceeded a reasonable turnaround; **no application code was changed this pass** (review-only), and every reviewed commit individually passed full CI (including this suite) before merging to `main`, which this pass's own baseline fetch confirmed is at a green tip |
| `npm run typecheck` / `npm run lint` / `npx vitest`      | ⚠️ not run — same reason (frontend `node_modules` not installed in this sandbox); no frontend file in this feature's declared scope changed this window                                                                                                                                                                                                                                    |

Static analysis (flake8/black/isort/migrations/route-permissions) is the
part of the gate independent of a pre-built environment and ran clean; the
test-runner gates could not be executed here. Flagging this explicitly per
the skill's own rule rather than reporting a gate not run.

Rotation row 16 → ✅ (pending this PR's merge). Next: Feature 17 (Training
core).

---

## Pass 9 (2026-10-19) — near-zero delta (3 of 271 commits in scope), 0 fixes needed, 0 new findings

**Watchdog pickup.** No open PR's head branch starts with
`claude/security-review-` (`search_pull_requests`, 0 results), and the
dedicated loop session (`session_011T1ZyyLrD5HagusgK9uDw2`) was not
reachable (`ListAgents`). PR #3436 (Feature 15, Scheduling, pass 9) had
already merged. Rotation row 16 (Events & requests) was the next pending
feature.

### Scope

Baseline `28987390b` (PR #3294's merge, pass 8). **271 non-merge commits**
landed repo-wide in the window; only **3** touch this feature's declared
files (`events.py`, `event_service.py`, `event_organizer_service.py`) —
confirmed via `git log 28987390b..HEAD --no-merges -- <declared files>`.
`event_requests.py`, `event_attendance_petitions.py`,
`event_attendance_petition_service.py`, `event_request_service.py`,
`models/event.py`, `models/event_request.py`, and the frontend `modules/events`
tree have zero diff since pass 8 — confirmed by the same command against
each path.

### Commits reviewed

- **`37c057558`** ("Persist cleared fields on the remaining module edit
  forms") — repo-wide Pitfall #1 sweep; this feature's slice is the Event
  editor and Event template edit forms sending an explicit `null`/`[]` for a
  cleared optional field instead of omitting the key, plus a backend
  correctness fix in `override_rsvp_attendance`
  (`event_service.py:2640`-area): a `override_duration_minutes` value that
  was auto-derived from the previous check-in/check-out pair is now dropped
  when either time is cleared (narrowly — only when the stored duration
  still equals the old derived span and the request itself doesn't name a
  duration), so a stale derived value can't keep crediting a span that no
  longer exists. No tenancy/auth surface; verified the condition only
  _narrows_ when the value is cleared, never widens what gets dropped.
- **`ffbdaa09a`** ("Email event cancellations, changes and organizer
  notices") — adds email (Pitfall #18's channel of record) for event
  cancellation, `PATCH /events/{id}` changes, and the existing
  `POST /{event_id}/notify` endpoint (already `events.manage`-gated,
  unchanged by this commit). All three new send paths route through the new
  `_event_email_recipients` helper, which loads `User` filtered on
  `User.organization_id == organization_id` and `User.id.in_(ids)` — no
  cross-tenant recipient is reachable regardless of which `user_ids` list a
  caller assembles upstream. Every interpolated dynamic value
  (`event.title`, `location_name`, the organizer's free-text `message`, the
  change description, the view-event URL) is passed through `html.escape`
  before landing in the HTML body (`event_service.py` new
  `_email_event_cancellation`/`email_event_change`/
  `_email_event_notification` methods) — confirmed by direct read, not
  assumed from the commit message. The one un-escaped use of `event.title`
  is in an email **subject** line (`subject = f"{label}: {event.title}"`,
  `send_event_notification`'s existing codepath, label from a fixed
  dict) — not a new risk: the endpoint already requires `events.manage`
  in-org (unchanged by this commit, confirmed at `events.py:3681`), so the
  only actor who can put arbitrary text in `event.title` is already a
  privileged same-org member, the same trust boundary every other
  organizer-authored field in this feature already crosses. All three new
  email sends are wrapped in `try/except Exception: logger.error(...)`,
  non-fatal, matching this feature's existing pattern for best-effort side
  effects (bell already committed/sent before the email is attempted).
- **`52ebfd66c`** ("Send the post-event validation prompt to the event's
  organizers") — `scheduled_tasks.py::run_post_event_validation` now asks
  the event's organizer/alternate (falling back to the creator only when
  neither is an eligible member) instead of only the creator, via
  `EventOrganizerService.organizer_duty_recipients` (renamed from
  `series_reminder_recipients`, same org-scoping). That helper's only new
  logic is `_active_users(organizer_ids(event), organization_id)` — an
  existing, already-reviewed method that filters `User.organization_id ==
organization_id`; no new unscoped query introduced. The task's own
  `Event` query remains scoped to the org being iterated (unchanged by this
  commit). Each recipient's email continues to use `_html.escape` on
  `event.title` and the recipient's name before interpolation (unchanged
  lines, confirmed by direct read of the surrounding context this commit
  did not touch).

### Re-verified standing items

- **EV-26 — still fixed, unregressed.** `check_overlapping_events` call
  sites unchanged this window (zero diff on `event_service.py`'s locking
  section and `event_requests.py::schedule_request`, confirmed by the scope
  check above). `KNOWN_LIMITATIONS.md`'s EV-26 entry re-read, still
  accurate.
- **EV-23 — still resolved**, zero diff on `rsvp_to_series` /
  `_evaluate_session_phase_warning` this window.
- **`check_request_status`'s 256-bit token** — `generate_status_token()`
  unchanged (zero diff on `models/event_request.py` this window); same
  conclusion as every prior pass.
- **`ondelete="SET NULL"` nullability** — zero diff on both model files
  this window, so no new FK to re-check beyond pass 8's line-by-line pass.

### Route inventory

**Unchanged: `events.py` 58, `event_requests.py` 23,
`event_attendance_petitions.py` 7** — confirmed via `grep -c '^@router\.'`
on each file; none of this window's 3 in-scope commits touch a route
decorator.

### Verified good ✅ (pass 9)

- No new unbounded query, no new CSV export, no new `.like()`/`.ilike()`
  usage, no new JSON-column shallow-copy mutation, no new unauthenticated
  route, no new client-supplied FK accepted without an in-org check.
- The three real commits in scope are each a correctness fix or an
  additive notification channel, all org-scoped and output-escaped as
  detailed above; none touches auth, permissions, or tenant isolation.

### Completion gate

| Check                                                                                    | Result                                            |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------- |
| `flake8 app/ tests/ alembic/`                                                            | ✅ 0 violations                                   |
| `black --check app/ tests/ alembic/`                                                     | ✅ clean (2460 files unchanged)                   |
| `isort --check-only app/ tests/ alembic/`                                                | ✅ clean                                          |
| `python3 scripts/validate_migrations.py --strict`                                        | ✅ single head `7ce50d36b948`, 627 revisions      |
| `test_alembic_migrations.py`/`test_migration_create_all_tables.py`                       | ✅ 80 passed                                      |
| `python3 scripts/check_route_permissions.py --strict`                                    | ✅ 272 routes, 0 errors, 0 warnings               |
| `pytest tests/ -k "event"` (python3.13)                                                  | ✅ 1434 passed, 1 pre-existing skip (`pywebpush`) |
| `npm run typecheck`                                                                      | ✅ clean                                          |
| `npm run lint`                                                                           | ✅ clean (exit 0)                                 |
| `npx vitest run` (events module + `EventForm`/`EventTemplateForm`/`EventEditPage` tests) | ✅ 125 passed (4 files)                           |

Alembic was forked into two heads (`4e18470473d6`/`d80493f28236`) at the
start of this pass — unrelated to this feature. Rather than add a second,
competing merge revision, this PR adopted PR #3437's `7ce50d36b948`
unchanged; see the Log entry in `PROGRESS.md` for detail.

Rotation row 16 → ✅ (pending PR merge). Next: Feature 17 (Training core).

---

## Pass 8 (2026-10-15) — real delta (36 commits), 0 fixes needed, file-storage hardening + two new attendance-petition routes reviewed clean

**Watchdog pickup.** PR #3291 (Feature 15, Scheduling, pass 8) had merged
touching only `PROGRESS.md` and its own findings file (docs-only, confirmed
via `git show --stat` on the merge commit, `dbe9abc3c`), so per
`PROGRESS.md`'s own rule it was not independently recordable. No
`claude/security-review-*` PR was open (`search_pull_requests`,
`is:open head:claude/security-review-`, 0 results); rotation row 16
(Events & requests) was the first `⬜`.

### Scope

**Confirmed a complete clone before trusting any commit count** —
`git rev-parse --is-shallow-repository` → `false`; no truncation risk.
Since pass 7's merge (`b48425bea`, PR #2972, 2026-10-06): **36 non-merge
commits** touch this feature's declared files (32 across the 7 backend
`.py` files below the model layer, plus the 2 model files and 1 frontend
file, counted separately) — another genuinely active window, not a
near-zero-delta one.

**No scope gap this pass.** `guest_check_in_service.py` and
`attendance_dashboard_service.py` (named in the XC-1 commit message below
as already-validated callees) were checked for their own changes in this
window: `guest_check_in_service.py` picked up only a mypy-typing commit
(`de96f2367`, no behavior change); `attendance_dashboard_service.py` is
Users/Membership-domain code (meeting attendance, voting eligibility), not
Events', and already belongs to a different rotation slot. Neither needed
adding to this feature's declared scope, unlike pass 7's petition/organizer
files.

### Re-verified standing items

- **EV-23 — now resolved**, between pass 7 and this pass (owner decision,
  2026-10-11). `e78ffd4f2` ("feat(events): warn on every ahead-of-phase
  session in a series RSVP (EV-23)") adds `SeriesPhaseGateWarning` and an
  `override` parameter to `rsvp_to_series` (`event_service.py:2404`+):
  a **going** series RSVP now evaluates `_evaluate_session_phase_warning`
  for every future occurrence before writing anything, and if any are
  ahead of the member's training phase, raises a 409 `phase_gate` with the
  full list of occurrences rather than silently overriding, as it did when
  pass 3/4/6/7 left this open. `useRSVPForm`'s series branch confirms
  against the list and retries with `override=true`. Tests:
  `test_event_rsvp_waitlist.py::TestRsvpToSeries`,
  `test_series_rsvp_phase_gate_endpoint.py`, `hooks/useRSVPForm.test.ts` —
  all present and passing in this pass's own gate run. `KNOWN_LIMITATIONS.md`'s
  EV-23 entry already carries the `✅ Resolved` banner — re-read and
  accurate, not re-asserted. **Closed.**
- **EV-26 — still fixed, unregressed.** The per-department
  `organization_locks` upsert-before-event-lock mechanism pass 7 confirmed
  fixed is untouched in this window (`check_overlapping_events` call sites
  in `event_service.py::create_event`/`update_event` and
  `event_requests.py::schedule_request` all still route through it — grepped
  at their current line numbers, same shape as pass 7). `KNOWN_LIMITATIONS.md`'s
  EV-26 entry (the accepted cross-department residual) re-read and still
  accurate.
- **`check_request_status`'s 256-bit token, still unrated-limited by
  design** — `generate_status_token()` (`models/event_request.py:41`)
  still `secrets.token_urlsafe(32)`, confirmed unchanged by direct read
  (the model file's diff this pass is the `Mapped[]`/`mapped_column()`
  rewrite only — see below — no change to the function body). Neither
  `GET /status/{token}` nor `POST /status/{token}/cancel` carries a
  rate-limit dependency; same conclusion as every prior pass — brute-forcing
  a 256-bit token is not the threat a per-IP limiter addresses, and both
  routes require possessing the token. `POST /status/{token}/cancel` does
  still carry its own `check_ip_rate_limit` (mutation + email amplification
  guard), unchanged.
- **`ondelete="SET NULL"` nullability** — every FK in `models/event.py` and
  `models/event_request.py` re-checked line-by-line against the full model
  diff (both files were rewritten this window from `Column(...)` to
  `Mapped[T] = mapped_column(...)` for mypy — see below); every `SET NULL`
  FK (`Event.organizer_id`/`alternate_organizer_id`/`last_modified_by`,
  `EventRSVP.overridden_by`, `EventAttendancePetition.reviewed_by`,
  `EventRequest.assigned_to`/`event_id`/`shift_id`, the prospect-link
  fields) still pairs with `nullable=True`. No regression from the rewrite.

### Real commits reviewed

- **`7835d0bb5`** ("Confine stored upload files to their organization and
  close file-access gaps") — Phase 1 of a repo-wide file-storage hardening
  pass. Its `events.py` hunk (84 lines) is a genuine security hardening fix,
  already landed and tested, not something this pass needed to apply:
  `GET /{event_id}/attachments` and `GET /{event_id}/attachments/{id}`
  previously required only `get_current_user` (any authenticated member of
  _some_ org — org-scoped by the query, but with no permission check at
  all) and now require `events.view` or `events.manage` via
  `_load_event_for_attachment_read`, which also 404s a draft event's
  attachments for a non-manager (same response as "doesn't exist", per the
  no-403-oracle pattern this feature uses elsewhere). The upload path also
  gained an extension/detected-MIME agreement check and started storing/
  trusting only the detected MIME type, and downloads now serve a stored
  `file_type` as `application/octet-stream` unless it is in
  `ALLOWED_ATTACHMENT_MIME_TYPES` — closing a path where the `attachments`
  JSON column, being writable through the generic event update payload,
  could otherwise get an attacker-chosen `Content-Type` echoed back at
  download time. Read in full; no gap found in the new code.
- **`1a2aae0d7`** ("fix(events): validate client-supplied foreign keys are
  in-org (XC-1)") — `PATCH /events/settings`'s
  `request_pipeline.default_assignee_id` is now checked with
  `assert_in_org` before being persisted (`events.py:945`+), closing a gap
  where a foreign org's user id was stored (though never actioned, since
  `apply_default_assignee` already re-checked at read time). Already
  landed with its own test (`test_xc1_scheduling_events.py`); re-verified
  by direct read, not re-derived.
- **`9069e0674`/`dd7f2dae9`/`2b07517ed`/`02227688c`** — the attendance-
  petition withdraw/pending-list feature, the two new routes in
  `event_attendance_petitions.py`:
  - `GET /attendance-petitions/pending?scope={mine,all}` —
    `list_pending_for_reviewer` raises `PermissionError` (→ 403) for
    `scope=all` unless the caller holds `events.manage`
    (`event_attendance_petition_service.py:249`); `scope=mine` (the
    default) is further restricted in the query itself to events the
    caller organizes or is alternate for
    (`Event.organizer_id == reviewer.id OR Event.alternate_organizer_id
== reviewer.id`), and the join on `Event` carries
    `Event.organization_id == organization_id` so no cross-tenant read is
    possible regardless of scope. The caller's own petitions are excluded
    either way (separation of duties, `pending_petition_criteria`).
  - `DELETE /{event_id}/attendance-petitions/mine` — `withdraw()` takes
    `.with_for_update()` on the petition row before checking/incrementing
    `withdrawal_count`, closing the same race `create_or_update_rsvp`
    already guards against (Pitfall #27); capped at
    `MAX_PETITION_WITHDRAWALS` (2) so the request cannot be cycled to
    re-notify reviewers indefinitely; a decided (non-pending) petition
    cannot be withdrawn.
  - The frontend route, `/events/attendance-requests`
    (`pages/AttendanceRequestsPage.tsx`, wired in
    `modules/events/routes.tsx`), is reachable by **any** authenticated
    member with no client-side permission gate — correct, since the
    server decides the visible set per the scope rules above and a route
    gate would only lock out organizers who hold no `events.manage`.
    Registered in all three route registries (`APPLICATION_PAGES.md:296`,
    `testingRegistry.ts:319`, `mobile-route-inventory.ts:274`) —
    `check_route_permissions.py --strict` confirms 0 errors against the
    current 270-route count.
  - The companion migration, `a0b34c886658`, adds the `withdrawn` enum
    value and `withdrawal_count` column; both guarded with `_has_table`/
    `_has_column` checks for a `create_all`-built install (Pitfall/
    Checklist #26), and the downgrade deletes `withdrawn` rows before
    narrowing the enum back. Reviewed clean.
  - Reviewer-facing emails in `_notify_reviewers` still run `name`/`title`/
    `petition.reason` through `html.escape` (confirmed at
    `event_attendance_petition_service.py:759` and the surrounding HTML
    template) before interpolating into the HTML body; the new
    finalized-event notice text added alongside is static, not
    user-supplied.
- **`da31be810`** ("fix(events): a finalized event can be edited from the
  edit form") — business-rule correctness fix (an attendance-finalized
  event's edit form could not save even an unrelated field, e.g. a title
  typo); `update_event`/`update_future_events` now compare each
  attendance-sensitive field against its _stored_ value rather than
  refusing on mere presence in the payload. No tenancy or auth surface;
  the attendance lock itself (which fields are refused when actually
  changed) is unweakened — re-read the full diff to confirm the refusal
  condition narrowed correctly rather than being dropped.
- **`3cdbef61f`** (W21-6) — `get_analytics_summary`'s "Avg Attendance
  Rate" changed from a pooled ratio (which counted an upcoming event's
  not-yet-checked-in Going RSVPs as no-shows) to a mean of each _past_
  event's own checked-in/Going ratio. Math correctness, still
  `organization_id`-scoped on every query touched, no new unbounded query.
- **`bd89a18a5`/`4cc9d4ae8`** (W19-1/W19-3) — waitlist promotion now also
  emails the promoted member (through `member_receives_email`/
  `EmailKind.EVENT_WAITLIST`, respecting the member's own notification
  preference and the department's required-kinds policy — Pitfall #18
  compliant) and records the promotion in `RSVPHistory` with
  `is_automatic=True`, so an automatic promotion cannot be misread as the
  member's own status change. Both non-fatal (wrapped in
  `try/except Exception: logger.error(...)`), matching this feature's
  existing discipline for best-effort side effects.
- **`9aca4fb41`** ("Fix mypy errors under app/api … and five real bugs")
  — two of the "five real bugs" land in this feature's files:
  `get_outreach_type_labels` (public, no-auth) no longer does a
  module-level circular import of `EVENT_SETTINGS_DEFAULTS` from
  `events.py` (replaced with `get_outreach_types(None)`, same output);
  `update_event`/`check_in_attendee`/`manager_add_attendee`/
  `override_rsvp_attendance`/`record_actual_times`/`reopen_attendance`/
  `get_qr_check_in_data` all previously tested only `if error:` against a
  `(obj, error)` tuple that can legitimately be `(None, None)` for a
  truthy-but-empty case — a real 500-instead-of-404 bug on an unknown
  event id with a significant change, now fixed to `if error or obj is
None` with a regression test (`test_update_event_unknown_id.py`).
  Correctness, not a security finding, but read in full since it touches
  every error-handling branch in the file.
- **`265a26be3`/`51c77a9ce`/`0d4d7c5a0`/`99a573420`/`d59c4cfda`/
  `197bdc9fe`/`ce50c5c6b`/`435c97cd2`/`73d2aedb9`/`0adb6353d`/`1a883bd8d`/
  `04ed11ca9`/`6cd9c199f`/`c5c761220`/`f81e769a5`/`1a7abb5d8`/`a1dfe82e3`/
  `010012f06`/`b893e01ff`/`1e61e28a6`/`4ccd5daa6`** — remaining merges,
  mypy-typing/`Mapped[]` narrowing passes, display-only text changes
  (resend-count wording, finalized-event reviewer notice), and the
  repo-wide upload-storage/encryption-at-rest phase 2
  (`ce50c5c6b`/`197bdc9fe`) whose touch on this feature's files is limited
  to the same attachment path already covered under `7835d0bb5` above.
  Spot-checked each for a new unscoped by-id query or a dropped
  `nullable=True`; none found.

### Route inventory

**`events.py`: 58 routes, unchanged** — confirmed via
`git diff b48425bea..HEAD -- events.py | grep -E '^[+-]@router\.'`
showing only the pre-existing `/{event_id}/attachments` list route (its
dependency strengthened, not replaced — see `7835d0bb5` above), and via a
fresh `grep -c '^@router\.'` count. **`event_requests.py`: 23 routes,
unchanged** — zero `@router` decorator diff lines.
**`event_attendance_petitions.py`: 7 routes, up from 5** — the two new
routes reviewed above, confirmed via the same diff method.

### Verified good ✅ (pass 8)

- No new unbounded query, no new CSV export, no new `.like()`/`.ilike()`
  usage, no new JSON-column shallow-copy mutation (the one JSON-column
  write touched, `custom_fields`, now goes through the new
  `_with_own_lifecycle_markers` helper, which `copy.deepcopy()`s both the
  event's own lifecycle keys and the incoming payload before merging —
  stronger than the shallow-copy-and-reassign pattern Pitfall #12 warns
  against), no new seeded-grant change without a migration, no new
  unauthenticated route in this feature's own files.
- Every `SET NULL` FK still `nullable=True` after the `Mapped[]` rewrite
  of both model files (checked line-by-line, see above).
- The two new attendance-petition routes are clean on every checklist
  dimension (auth, permission/separation-of-duties, tenant isolation, row
  locking, output escaping), detailed above.
- The file-storage hardening commit's touch on this feature
  (`7835d0bb5`) is a genuine, already-fixed security hardening of the
  attachment list/download/upload paths — reviewed in full, no residual
  gap.

### Completion gate

| Check                                                 | Result                                            |
| ----------------------------------------------------- | ------------------------------------------------- |
| `flake8 app/ tests/ alembic/`                         | ✅ 0 violations                                   |
| `black --check app/ tests/ alembic/`                  | ✅ clean (2334 files unchanged)                   |
| `isort --check-only app/ tests/ alembic/`             | ✅ clean                                          |
| `python3 scripts/validate_migrations.py --strict`     | ✅ single head `c903fc771081`, 601 revisions      |
| `python3 scripts/check_route_permissions.py --strict` | ✅ 270 routes, 0 errors, 0 warnings               |
| `pytest tests/ -k "event"` (python3.13)               | ✅ 1345 passed, 1 pre-existing skip (`pywebpush`) |
| `npm run typecheck`                                   | ✅ clean                                          |
| `npm run lint`                                        | ✅ clean (exit 0)                                 |

Rotation row 16 → ✅ (pending PR merge). Next: Feature 17 (Training core).

---

## Pass 7 (2026-10-06) — real delta (33 commits), 0 fixes needed, EV-26 confirmed fixed, scope widened by 3 files

**Watchdog pickup.** PR #2971 (Feature 15, Scheduling, pass 7) had merged
with 0 application-code changes (docs-only), so per `PROGRESS.md`'s own
rule it was not independently recordable. No `claude/security-review-*`
PR was open; rotation row 16 (Events & requests) was the first `⬜`.

### Scope

**Confirmed full-depth clone before trusting any commit count** —
`git fetch --unshallow` reported "already a complete repository"; no
truncation risk here. Since pass 6's merge (PR #2630, `f39a6c4fd`,
2026-09-17): **33 non-merge commits** touch the 12 declared scope files
— a genuinely active window, not a near-zero-delta one like pass 6.

**Scope gap found and closed.** Two new backend files
(`api/v1/endpoints/event_attendance_petitions.py`,
`services/event_attendance_petition_service.py`,
`services/event_organizer_service.py` — three files total) were added in
this window by real Events-feature commits (`9069e0674`, `e7918349b`)
but sat outside the declared 12-file scope, so a future pass would not
have picked up their diff. Reviewed all three in full against all seven
checklist dimensions this pass (see below) and found clean; **added to
this feature's declared scope** (header above) so they're diffed going
forward rather than silently skipped.

### Re-verified standing items

- **EV-26 — confirmed fixed, not merely unchanged.** `5b0929492`
  ("fix(events): serialize room bookings per department (EV-26)",
  2026-10-04) adds an `organization_locks`-style upsert lock
  (scope `room_booking`) taken before `check_overlapping_events` reads
  with `.with_for_update()`, and makes `update_event` take that lock
  before its own event-row lock. All three standing call sites
  (`event_service.py::create_event` ~line 394, `::update_event`
  ~line 924/1000, `event_requests.py::schedule_request` ~line 1131) now
  go through the locked path — confirmed by direct read, not the commit
  message. A same-day follow-up (`012f3da49`) generalizes the lock table
  for reuse by Training's enrollment lock without weakening this
  mechanism (same scope string, same upsert-before-event-lock order).
  `KNOWN_LIMITATIONS.md`'s EV-26 entry already documents the fix and its
  accepted cross-department residual (two departments racing the same
  gap-lock boundary fails loudly with a deadlock retry rather than
  double-booking) — re-read and confirmed accurate, not re-asserted.
  **Closed as fixed**, carrying forward only the documented residual.
- **EV-23 — still open, unchanged in substance.** `rsvp_to_series`
  (now `event_service.py:2181`, shifted from ~1808 by unrelated
  training-credit additions earlier in the file) still passes
  `override=True` unconditionally into `create_or_update_rsvp`
  (now line 2243), with the same comment naming a confirmation step the
  series UI still never collects. Still a product decision, not a bug;
  `KNOWN_LIMITATIONS.md`'s entry re-read and still accurate.

### Real commits reviewed, all clean (one is a genuine security-adjacent fix)

- **`f00912e1b`** — fixes 11 routes that either leaked the raw
  `ATTENDANCE_LOCKED::` internal marker or over-sanitized a legitimate
  lock message into a generic 500/400 instead of the correct 409.
  Security-adjacent error-handling correctness fix, well-tested with a
  new AST guard.
- **`e7918349b`** — adds `organizer_id`/`alternate_organizer_id` to
  `Event`, a `POST /events/{id}/transfer` route, and
  `event_organizer_service.py`. `validate_pair` explicitly validates
  both ids are active members of the caller's org before storing
  (XC-1, cited by name in-code); both FKs are `SET NULL` +
  `nullable=True`.
- **`9069e0674`** — new attendance-petition feature (model, 5-route
  endpoint file, service). Every route requires auth; `_assert_may_decide`
  refuses a reviewer deciding their own petition (separation of duties);
  every by-id lookup is org-scoped (XC-3); `approve()` locks the event
  row before the petition row (Pitfall #27); petition text is
  `html.escape`d before any email; `/attendance-petitions` already in
  `UNCACHEABLE_SUBSTRINGS` (added by the same commit).
  `EventAttendancePetition.reviewed_by` is `SET NULL` + `nullable=True`.
- **`106eed9c0`, `0d17c6e8a`, `cd3bf9339`, `b65142bd4`, `9d4d0d168`,
  `0f8aaafc5`, `a88005082`** — large training-credit/attendance-finalize
  rewrite series. Spot-checked every new `select()` for org-scoping (one,
  in `cd3bf9339`, actually added a missing `EventRSVP.organization_id`
  filter that wasn't there before — a minor hardening, not previously
  flagged); every new `.with_for_update()` pairs with
  `populate_existing=True` per the stated identity-map problem. No new
  XC-1/XC-3 issue.
- **`2317a5ca7`** (app-review W18, HIGH) — fixes recurring-series
  generation stepping in UTC instead of department wall-clock (a real DST
  bug) and fixes "this and all future" copying absolute times instead of
  applying a shift. Correctness, no tenancy/auth surface.
- **`690c9675c`, `ff78de73a`, `163916218`, `44b7b6a75`, `cd8c76135`,
  `977fc3a7d`** — refusal-message counting, all-or-nothing cohort
  shift/cancel via `defer_commit`, attendance-lock keyed on changed
  values rather than present fields, a clamped check-in pre-fill with a
  new org-scoped roster field, a server-computed `check_in_closes_at`
  field, and a sanitization wording/test strengthening. All clean.
- **`68169a1fe`, `63227fbba`** (workflow-review W19/W20) — an additive
  computed field and a cosmetic label fix. Real but minor, both clean.
- **`72dfb4f1e`, `b5fe2ca00`, `982a08d0b`, `e3ef10465`, `4c288887e`,
  `ccef747b2`, `68efcc3b9`, `28c2a3777`, `f92fbd927`** — shared
  email-policy/template plumbing and department-local-date/preferred-name
  display fixes, touching this feature's files only incidentally. All
  clean, no tenancy/auth surface.
- **`014a4a44a`** — declares explicit `ondelete="RESTRICT"` on previously
  implicit FKs in `event.py`. Every `SET NULL` FK in the current file
  (`organizer_id`, `alternate_organizer_id`, `last_modified_by`,
  `EventAttendancePetition.reviewed_by`, the prospect-link fields) still
  pairs with `nullable=True` — re-verified by reading every occurrence.

**Out of this feature's scope, correctly excluded:** `dabae068a` (app-review
Locations pass 3) and `a0307629d` (NFC-kiosk badge-tap) both touch
`location_service.py`, but only the NFC-kiosk code Locations owns, not
`check_overlapping_events` — confirmed via diff, and both are already
reviewed under the Locations feature's own rotation slot.

### Route inventory

**`events.py`: 58 routes, up from 55** — the two additions are
`GET /settings/position-options` (`events.manage`-gated, org-scoped
query) and `POST /{event_id}/transfer` (reviewed above), confirmed via
`git diff <baseline>..HEAD -- events.py | grep '^\+@router'` showing
exactly these two, and independently via a fresh `@router.*` decorator
count. **`event_requests.py`: 23 routes, unchanged** — zero diff in
`@router` decorator lines since baseline.

### Verified good ✅ (pass 7)

- No new unbounded query, no new CSV export, no new `.like()`/`.ilike()`
  usage, no new JSON-column shallow-copy mutation, no new seeded-grant
  change without a migration, no new unauthenticated route in this
  feature's own files (the one new public-facing surface in the window,
  the NFC-kiosk badge-tap, belongs to the Locations feature and is
  reviewed there — rate-limited, minimized response, audited).
- The three newly-in-scope files (petitions + organizer transfer) are
  clean on every checklist dimension, detailed above.

### Completion gate

| Check                                                 | Result                                            |
| ----------------------------------------------------- | ------------------------------------------------- |
| `flake8 app/ tests/ alembic/`                         | ✅ 0 violations                                   |
| `black --check` (scope)                               | ✅ clean                                          |
| `isort --check-only` (scope)                          | ✅ clean                                          |
| `python3 scripts/validate_migrations.py --strict`     | ✅ single head `15802f3df5c4`, 527 revisions      |
| `python3 scripts/check_route_permissions.py --strict` | ✅ 245 routes, 0 errors, 0 warnings               |
| `pytest tests/ -k "event"`                            | ✅ 1224 passed, 1 pre-existing skip (`pywebpush`) |
| `npm run typecheck`                                   | ✅ clean                                          |
| `npm run lint`                                        | ✅ clean                                          |

Rotation row 16 → ✅ (pending PR merge). Next: Feature 17 (Training core).

---

## Pass 6 (2026-09-17) — 0 fixed, 0 new findings, EV-23 and EV-26 re-confirmed unchanged, near-zero-delta re-verification against pass 5

**Scoped since pass 5's merge:** `abf8304de` (PR #2573/#2574). Diffed the full
declared surface — `events.py`, `event_requests.py`, `event_service.py`,
`event_request_service.py`, `models/event.py`, `models/event_request.py`,
`schemas/event.py`, `schemas/event_request.py`, `utils/event_attachments.py`,
`mcp/tools/events.py`, `mcp/tools/writes.py`, `services/location_service.py` —
plus one repo-wide `--stat` and one content grep (not filename) across every
new migration since the last pass, per the SCH-15/EC-14 lesson prior passes
in this file established.

**Ten of the twelve declared files are byte-identical to pass 5** (`git diff
--stat` returns nothing for `event_requests.py`, `event_request_service.py`,
both models, both schemas, `event_attachments.py`, both MCP tool files, and
`location_service.py`). Zero new migrations touch any table this feature owns
— in fact zero new migration files exist at all since pass 5's merge
(`git diff --name-only` against `alembic/versions/` is empty), so the
migration-content-grep step this pass ran had nothing to check.

**The only two changed files, `events.py` (+8/-4 by `--stat`, net 4 lines
excluding a comment) and `event_service.py` (+75/-0), are not this feature's
own change.** Both are entirely `49a7253ce` ("feat(prospective-members):
advance a meeting stage on finalized attendance") plus its immediate follow-up
`f999c0be0` — Membership Pipeline's own rotation feature (08, already ✅ this
pass), which moved a prospective-member meeting-stage advance off the
check-in moment and onto the event's own finalize/settle moment. Read in full
rather than skipped because it lands inside two files this feature owns:

- **`events.py`'s change is a comment-only removal.**
  `check_in_external_attendee` (around line 3288) no longer calls
  `GuestCheckInService.try_advance_attendance_pipeline` directly at check-in
  time — the call site is gone, replaced by a comment explaining the advance
  now runs at finalize. `GuestCheckInService` stays imported and used
  elsewhere in the file (`link_prospect_to_event`, confirmed by grep), so no
  F401. No route added or removed, no permission gate touched.
- **`event_service.py` gains `attendance_is_settled()` (a pure predicate: the
  event's attendance is finalized, or its effective end time is more than
  `PIPELINE_ATTENDANCE_SETTLE_DAYS` — default 7 — in the past) and
  `_advance_prospects_after_finalize()`, called from both of
  `finalize_event_attendance`'s exits.** Checked against this feature's own
  conventions: the naive-vs-aware datetime handling
  (`effective_end.replace(tzinfo=dt_timezone.utc)` when naive) matches the
  same `_as_utc` pattern this file already uses elsewhere (pass 5's own
  write-up on `_as_utc`/`_as_aware`), and the new `from app.core.config import
settings` import is used exactly once, so no F401/F811. The advance itself
  delegates to `GuestCheckInService(self.db)
.advance_prospects_for_settled_event(event)` inside a bare
  `try/except Exception: logger.exception(...)` — correct per the method's own
  docstring ("a pipeline failure must never roll back a finalize"), and
  matches this feature's existing discipline of never letting a best-effort
  side-effect turn a successful write into a 500 (the same shape
  `check_in_external_attendee`'s prospect-link try/except already used before
  this diff).
- **Read the callee anyway, since it queries `EventExternalAttendee` by
  `event_id` and this feature owns that table's parent.**
  `GuestCheckInService.advance_prospects_for_settled_event`
  (`guest_check_in_service.py:338`) filters
  `EventExternalAttendee.event_id == str(event.id)` **and**
  `EventExternalAttendee.organization_id == str(event.organization_id)` —
  correctly org-scoped, and `event` itself is always the row
  `finalize_event_attendance` already fetched org-scoped, so no
  client-supplied id reaches this query unfiltered. `try_advance_attendance_pipeline`
  passes `organization_id=str(event.organization_id)` on to
  `MembershipPipelineService.try_auto_advance_current_step` — same value,
  not attacker-influenceable. No IDOR, no cross-tenant read.
- **Two other files outside the declared list also changed and reference
  `Event`** (per the standing "grep beyond the declared list" discipline):
  `api/v1/endpoints/membership_pipeline.py` (`Event.id == event_id` paired
  with `Event.organization_id == organization_id` in the same `.where()`,
  line 867-869) and `services/membership_pipeline_service.py`
  (`_fetch_meeting_details`, `Event.organization_id == str(organization_id)`
  combined with `Event.id == str(event_id)` when an id is supplied, line
  3732+). Both are read-only, both org-scope every by-id lookup correctly,
  both are Membership Pipeline's own code and rotation entry, not this
  feature's — verified good, not a finding here, recorded so the "read
  everything that touches this feature's models" claim stays true rather than
  approximately true. `services/scheduled_tasks.py`'s new
  `run_prospect_attendance_advance` task (also MP-owned, not enumerated in
  this feature's declared surface) loops `organization_id`-scoped per org and
  never reads `Event` directly — no finding.
- **`forms_service.py` also changed (+178/-30) but not near the event-request
  intake path this feature shares with Forms.** Grepped the diff for
  `_process_event_request`/`event_request`/`EventRequest` — zero hits; the
  whole diff is Membership Pipeline's own form-submission-to-stage matching
  logic (comment-only change to a pre-existing query, per the diff read).
  Confirmed this feature's one shared entry point into Forms
  (`FormsService._process_event_request`) is untouched.

**Frontend:** one events-owned file changed,
`components/event-detail/EventProspectsCard.tsx` — a 3-line, purely cosmetic
diff (`card` → `card p-6`, `mb-3` → `mb-4`, `font-bold` → `font-medium`, no
logic, no new prop, no new API call). Confirmed by reading the full diff, not
inferred from the line count.

### Standing findings re-verified against current code, not re-derived

- **EV-26 still open, unregressed.** `LocationService.check_overlapping_events`
  (`location_service.py:286`) re-read in full: still a plain `select(Event)`
  with no `.with_for_update()` anywhere in the method. All three call sites
  unchanged: `event_service.py:234` (`create_event`), `event_service.py:782`
  (`update_event`), `event_requests.py:1129` (`schedule_request`'s
  create-calendar-event branch) — confirmed at their current line numbers by
  grep, not assumed from pass 5's citations. Left **FLAGGED**, same
  cross-cutting reasoning as pass 5 (the shared helper's other two callers,
  `training_session_service.py` and `course_cohort_service.py`, belong to
  different rotation features and a single-feature fix would change the
  helper's locking contract out from under them).
- **EV-23 still open, unregressed.** `rsvp_to_series`
  (`event_service.py:1808`) still passes `override=True` unconditionally at
  its one call into `create_or_update_rsvp` (line 1870, offset +62 from the
  function start — the function itself grew/shifted since pass 5 only because
  of unrelated code earlier in the file, not because this block changed), with
  the same "member confirmed... for the series" comment that names a
  confirmation the series UI still never collects. Left **FLAGGED**, same
  product-decision reasoning as passes 3-5.
- **Route inventory re-run from scratch (regex/AST extraction, not diff):**
  56/56 routes in `events.py`, 23/23 in `event_requests.py` — identical counts
  to pass 4/5. Every route's `Depends(...)` argument list extracted
  programmatically; the same five public/low-auth routes as every prior pass
  (`events.py`'s `GET /public-calendar` with no dependency;
  `event_requests.py`'s `POST /public` behind `_rate_limit_public_request` →
  `require_captcha` in that order, `GET /status/{token}`,
  `POST /status/{token}/cancel`, `GET /types/labels`). No new unauthenticated
  route.
- **`ondelete="SET NULL"` nullability, RSVP capacity locking (Pitfall #27,
  both halves), no `.like()`/`.ilike()` anywhere in this feature's files, no
  CSV export** — all re-confirmed by re-reading the current code, not
  re-cited from pass 5's text, since `models/event.py`, `models/event_request.py`
  and `event_service.py`'s RSVP/waitlist block are all byte-identical or
  untouched by this pass's one diff.

## Findings (pass 6)

None. Every change since pass 5's merge either belongs to another rotation
feature's own diff (Membership Pipeline, already ✅ this pass) touching this
feature's files incidentally and correctly (org-scoped, no new route, no new
unauthenticated surface), or is a 3-line cosmetic frontend tweak. Both standing
flags (EV-23, EV-26) re-confirmed unchanged at their current line numbers.

## Completion gate (pass 6)

| Check                                             | Result                                                 |
| ------------------------------------------------- | ------------------------------------------------------ |
| `flake8 app/ tests/ alembic/`                     | ✅ 0 violations                                        |
| `black --check app/ tests/ alembic/`              | ✅ 1599 files unchanged                                |
| `isort --check-only app/ tests/ alembic/`         | ✅ clean                                               |
| `python3 scripts/validate_migrations.py --strict` | ✅ single head, 444 revisions (same as pass 5, no new) |
| `pytest tests/ -k "event"`                        | ✅ 937 passed, 1 skipped (pre-existing, pywebpush)     |
| `npm run typecheck`                               | ✅ 0 errors                                            |
| `npm run lint`                                    | ✅ 0 errors/warnings                                   |

No file this feature owns needed a fix, so nothing was committed to
production code this pass; the only change in this PR is this findings-file
update and `PROGRESS.md`'s bookkeeping.

---

## Pass 5 (2026-09-15) — 0 fixed, 1 new finding flagged (EV-26, P2/P3, cross-cutting), EV-23 re-flagged, full re-verification against pass 4

**Scoped since pass 4's merge:** `32763ddbe` (PR #2451). Real churn in five
files: `api/v1/endpoints/event_requests.py` (+259/-49),
`api/v1/endpoints/events.py` (+2/-2), `schemas/event.py` (+11/-2),
`schemas/event_request.py` (+94/-13), `services/event_request_service.py`
(+~250 net) — `models/event.py`, `models/event_request.py`,
`utils/event_attachments.py`, `mcp/tools/events.py` and `mcp/tools/writes.py`
are **byte-identical** to pass 4 (`git diff --stat` confirms zero output for
all five). Two new migrations touch `organizations.settings`/`event_requests`:
`d19b2c2ae9b9` (enables `accept_public_requests` on orgs whose published form
already produces requests today — a careful, non-widening backfill, read in
full) and `0533644945cd` (settles off-list `date_flexibility`/
`venue_preference`/`preferred_time_of_day` values already stored, per pitfall
#20). Both guard on the target table existing (pitfall #26), are collation-
and MariaDB-aware, and document their own irreversibility correctly. No
finding in either.

**The whole diff is one feature: PR #2447, "public outreach event-request
pipeline" — tying `event_requests` to the department calendar and closing the
Forms-path/JSON-endpoint parity gap for the `accept_public_requests` toggle.**
This PR carried its own five rounds of Codex review during development
(`f9f80f798` through `055934f3f`, all visible in `git log`), so this pass's
job was to re-verify the merged result rather than assume the review history
implies safety. Read in full against all seven checklist dimensions:

- **Public-surface additions re-checked at the same bar as EV-5/EV-18/EV-19.**
  `submit_public_event_request`'s dependency order
  (`_rate_limit_public_request` → `require_captcha`), the 404-for-both
  (nonexistent org vs. opted-out org) oracle prevention, the honeypot's
  no-write/no-counter-spend contract, and the "every rejection above the
  daily-cap INCR" ordering are all **unchanged and re-confirmed** at their
  current line numbers (`event_requests.py:256-353`). The new
  `normalize_request_preferences` call sits _above_ the lead-time check,
  which is correct — it settles `date_flexibility` before the gate measures
  it, and neither reads nor writes anything metered.
- **The Forms-path second public entry into this pipeline
  (`FormsService._process_event_request`, `forms_service.py:2570-2820`) is
  Forms-owned code, not re-owned here** — its own `POST /public/forms/{slug}`
  endpoint carries its own `_rate_limit_submit` + `require_captcha` pair
  (`api/public/forms.py:143`), so it inherits rate-limiting and CAPTCHA
  independently rather than through this feature's dependency. Read anyway
  because it now calls seven functions this feature owns
  (`normalize_request_preferences`, `clamp_text_fields`,
  `parse_audience_size`, `public_daily_limit`, `lead_time_error`,
  `apply_default_assignee`, `get_pipeline_settings`): every fallible read
  (`parse_audience_size`, `_parse_request_date`) is ordered above the
  `daily_cap_exceeded` INCR, matching the JSON endpoint's own EV-19 discipline
  and explicitly commented as doing so (`forms_service.py:2727-2762`) — a
  malformed answer costs the one field, never the department's daily
  allowance. `clamp_text_fields` truncates (never rejects) free text to the
  columns' widths before that same counter, closing the one gap unique to
  this path: the JSON endpoint's schema already bounds every string via
  Pydantic `max_length`, but a generated public form's fields sit at
  `FormsService.MAX_TEXT_LENGTH` (5000), so nothing before this fix stopped an
  over-long mapped value reaching MySQL as a `DataError` _after_ the counter
  was already spent. Confirmed present, not merely commented.
- **Org-scoping (14a) re-verified by direct enumeration, not sampling.** Every
  `EventRequest.id == request_id` site in `event_requests.py` (9 occurrences:
  lines 749, 770, 896, 966, 1014, 1275, 1398, 1493, 1574) carries
  `EventRequest.organization_id == current_user.organization_id` (or, at
  `_load_request_for_staffing:1574`, the caller-supplied `organization_id`
  parameter, itself always `current_user.organization_id` at every call site —
  confirmed by grep) in the same `.where()`. The new
  `get_linked_calendar_event` helper (`event_request_service.py:429-451`)
  resolves the request's `event_id` through `Event.organization_id ==
event_request.organization_id` explicitly, with a comment naming pitfall
  #14a — a request row edited by any other path cannot be made to point at
  another org's calendar event and reach it through this link.
- **Client-supplied FK validation (14c) re-verified.** `schedule_request`'s
  `data.location_id` is checked with `assert_in_org` before being stored on
  the request (`event_requests.py:1046-1056`), and independently re-validated
  inside `EventService.update_event`/`create_event` when it actually reaches
  either (`event_service.py:727-733`, `:189-190`) — two checks, not one
  substituting for the other, both still present.
- **Update-payload omitted-vs-null discipline (pitfall #1) holds through the
  new calendar-sync code.** `sync_calendar_event_date`'s `update_fields` dict
  only ever contains `location_id` when the caller actually supplied one
  (`event_request_service.py:567-573`), matching `schedule_request`'s own
  `EventUpdate(**update_fields)` construction — a reschedule that names no new
  room does not clear the room the linked event already had.
- **JSON-column / dirty-tracking discipline (pitfall #12) — not applicable to
  this diff.** No JSON column is touched by any of the new functions;
  `event_request.event_end_date`/`event_date` are plain `DateTime` columns
  reassigned directly.
- **`_as_utc`/`_as_aware` datetime-awareness helpers, read in full.** Both
  correctly special-case a naive value as "already UTC" rather than raising or
  guessing, matching the model comment CLAUDE.md's Date/time rule requires;
  the schema-level one (`schemas/event_request.py:_as_utc`) is also careful to
  convert (not merely accept) an aware-but-non-UTC value before storage, since
  the MySQL driver formats by wall clock and silently drops the offset —
  confirmed this is exactly the bug the docstring says it fixes by reading the
  pymysql behavior claim against the driver's own datetime-formatting
  contract, not just trusting the comment.
- **No new CSV export, no `.like()`/`.ilike()`, no new unauthenticated route.**
  Re-confirmed by grep across the full diff; `import_events_csv` remains the
  only CSV-adjacent code in this feature (an import, unaffected).
- **Frontend:** two files changed since pass 4 (`EventTemplatesPage.tsx`,
  `EventsPage.tsx`), both from the cross-cutting pitfall #31 sweep
  (`0d3f9b833`, "Stop a click outside a dialog from discarding the form") —
  removed a `modal-overlay` click handler in each, matching the rule's
  mechanical fix exactly. Not this feature's own change and not re-litigated;
  confirmed the diff is nothing but that one-line removal in both files.
- **Route inventory:** 23/23 routes in `event_requests.py` (unchanged from
  pass 4), permission gates re-extracted programmatically and diffed —
  identical except the two lines already covered under events.py below. The
  five public/low-auth routes are the same ones prior passes named.
- **`events.py`'s only change:** `list_event_attendees` widened from
  `events.view` to `events.view` OR `events.manage` (`events.py:1718`) —
  the safe direction (a manager who lost the baseline `events.view` grant can
  still see who is coming), part of the same repo-wide "admit the manage
  grant to seven reads that branch on it" commit (`4b7bd1adb`) that touched
  several other features' files in this range; confirmed the other six reads
  it touched are outside this feature's two files.

### Re-verified from pass 4, not re-derived

- **EV-23 still open, unregressed.** `rsvp_to_series` still passes
  `override=True` unconditionally (`event_service.py`, byte-identical to
  pass 4 in this exact function per `git diff --stat`). Left **FLAGGED**,
  same reasoning as pass 3/4 — a product decision on what "the" phase-gate
  warning means for a series is still outstanding.
- **`ondelete="SET NULL"` nullability** — re-grepped all FKs across
  `models/event.py` and `models/event_request.py` (byte-identical to pass 4,
  so this is a re-confirmation of an unchanged file, not a fresh audit); all
  `nullable=True`.
- **RSVP capacity locking, both halves of Pitfall #27**, re-read at their
  current line numbers in `create_or_update_rsvp` and `promote_from_waitlist`
  — unchanged since `event_service.py` did not change in this pass's diff.
- **Events-specific MCP tools** (`app/mcp/tools/events.py`,
  `app/mcp/tools/writes.py`) — byte-identical to pass 4, no re-read needed.
- **`check_request_status`'s 256-bit token** — `generate_status_token()`
  unchanged (`models/event_request.py` byte-identical to pass 4); confirmed
  `secrets.token_urlsafe(32)` still the source. Neither public token route
  (`GET /status/{token}`, `POST /status/{token}/cancel`) carries a
  `_rate_limit_public_request` dependency, same as every prior pass — not a
  gap, since brute-forcing a 256-bit token is not the threat a per-IP limiter
  addresses and both routes require possessing the token to do anything.

## Findings (pass 5)

### EV-26 — P2/P3 (availability/correctness, cross-cutting) — room double-booking check has no row lock; two concurrent schedules can double-book the same location — FLAGGED, not fixed

**What:** `LocationService.check_overlapping_events` (`location_service.py:286`)
is a plain, non-locking `SELECT` — no `.with_for_update()` — that every write
path in this feature treats as its sole concurrency control for room booking:
`EventService.create_event` (`event_service.py:193`), `EventService.update_event`
(`event_service.py:741`), and `event_request_service`'s scheduling path via
`event_requests.py:1129` (`schedule_request`'s "create calendar event" branch).
Two coordinators (or one coordinator double-clicking, or two browser tabs)
scheduling different events into the same room for overlapping times can both
read "no conflict" before either has committed, and both commit — the same
read-then-write shape CLAUDE.md pitfall #27 describes for RSVP/shift seat
capacity, applied to a time-range instead of a seat count.

**This is not new code and not introduced by this pass's diff** — `create_event`'s
call site predates pass 1, and pass 1-4 never flagged it. Found this pass by
following pitfall #27 as a checklist item rather than only re-verifying the two
sites (RSVP, waitlist promotion) prior passes had already named — the same kind
of scope gap pass 2's own retrospective describes ("re-read the mechanisms
[the prior pass] had named" rather than searching for ones no pass had). Owned
here per CLAUDE.md's "no acceptable pre-existing errors": found while reviewing
this feature's own write paths, regardless of age.

**Failure scenario:** a department has one training room. Two officers, in two
tabs, each schedule a different outreach request (or one outreach request and
one ordinary training event) into that room for the same Tuesday evening.
Both `schedule_request`/`create_event` calls run `check_overlapping_events`
before either has written its new `Event` row; both see zero overlapping
events (the other transaction's insert isn't visible yet, and nothing locks
the location or the time range to prevent it); both proceed to create/update
their `Event`. The department now has two events booked into the same
physical room at the same time, discovered only when someone actually shows
up.

**Impact:** LOW/MED. No tenant-isolation or authorization boundary is
crossed — `location_id` and `organization_id` are both correctly scoped
throughout, so this cannot double-book _across_ organizations, only within
one. Every write site requiring this check already sits behind
`events.manage`, so the actors who can trigger it are coordinators, not
arbitrary members — this is a data-correctness/availability bug (a
physically double-booked room), not a security exposure, but for a fire
department a double-booked apparatus bay or training room has a real
operational cost.

**Why not fixed here.** This is genuinely cross-cutting, not confined to
Events & Requests: `check_overlapping_events` has the identical
no-lock shape at every one of its five call sites, and two of the other three
belong to different features entirely — `training_session_service.py:240`
and `course_cohort_service.py:220` (Training/Scheduling-adjacent, each with
their own rotation entry). A same-pass fix confined to this feature's two
call sites (`event_service.py`, `event_requests.py`) would leave the other
two callers of the identical unlocked helper unfixed while changing the
shared helper's locking contract out from under them — exactly the kind of
change CLAUDE.md's pitfall #22 warns is delicate to get right when a resource
is shared across independently-reasoned-about call sites. The correct fix
(most likely: `LocationService.get_location(..., for_update=True)` to lock
the `Location` row before running the overlap check and before the
create/update commits, mirroring the "lock the parent row, then take a
locking read" shape `create_or_update_rsvp`/`promote_from_waitlist` already
established for seat capacity) needs a single pass across all five call sites
at once, plus a check that no code path ever needs to hold a lock on both a
`Location` row and an `Event`/`Shift`/`Cohort` row in an order that could
deadlock against another path doing the reverse — that survey is out of scope
for a single-feature review.

**Recommendation for whoever picks this up:** add an optional
`for_update: bool = False` parameter to `LocationService.get_location`
(mirroring `get_shift_by_id`'s own `for_update` parameter, already
established in Scheduling), have every `check_overlapping_events` caller
lock the `Location` row first via that parameter before running the overlap
query and before the write, and add the new site to
`tests/test_capacity_locking.py`'s enumeration — that guard test currently
covers only hard seat/quantity caps (RSVP, shift assignment, budgets,
inventory) and has no entry for a time-range overlap check, so this class of
bug has no ratchet today. Mirrored in `docs/KNOWN_LIMITATIONS.md`.

## Completion gate (pass 5)

| Check                                             | Result                                                                                                                                                            |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `flake8 app/ tests/ alembic/`                     | ✅ 0 violations (no files touched this pass)                                                                                                                      |
| `black --check app/ tests/ alembic/`              | ✅ 1595 files unchanged                                                                                                                                           |
| `isort --check-only app/ tests/ alembic/`         | ✅ clean                                                                                                                                                          |
| `python3 scripts/validate_migrations.py --strict` | ✅ single head, 444 revisions (two new since pass 4)                                                                                                              |
| `pytest tests/ -k "event"`                        | ✅ 924 passed, 1 skipped (pre-existing, pywebpush)                                                                                                                |
| `pytest tests/` (full backend suite)              | ✅ 12577 passed, 21 skipped (all pre-existing: Docker/no-MySQL/optional-dep/opt-in), 0 failed                                                                     |
| `tsc --noEmit` / `eslint .`                       | not run — no frontend file touched by this pass's own changes (the two pitfall #31 files predate this pass and are already covered by that rule's own guard test) |

No backend or frontend file was modified in this pass — the one new finding
(EV-26) is cross-cutting and flagged rather than fixed, and every standing
flag/mechanism re-verified matched the code exactly, so there was nothing to
change.

---

## Pass 4 (2026-09-10) — 1 fix (EV-24, P2), EV-23 re-flagged, full re-verification against pass 3

**Scoped since pass 3's merge:** `7af79795` (PR #2216). Diffed the nine
files pass 3 declared, plus a fresh grep across every backend file changed
in range for `from app.models.event import` / `from app.models.event_request
import` / `EventService(` / `EventRequestService` / `event_request_service.`
— none found beyond the declared surface, so this pass's "nothing else
touches these models" claim is checked, not assumed (the EC-14/SCH-15
lesson pass 2/3 both cite).

**Five of the nine changed:** `events.py` (+94/-19), `schemas/event.py`
(+11), `event_service.py` (+36/-9, before this pass's own fix),
`forms_service.py` (+257/-30, a Forms-module deadlock-retry fix — see
below). `event_requests.py`, `event_request_service.py`,
`models/event.py`, `models/event_request.py`, `schemas/event_request.py`
are **byte-identical** to pass 3 (`git diff --stat` confirms). No new
migration touches `events`, `event_requests`, or `event_rsvps`
(`git diff --name-only` against `alembic/versions/`, then grepped each
changed file's content — not filename — for the three table names; zero
hits, matching the SCH-15-pass-2-established discipline of not trusting a
migration's filename to say what it touches).

**The whole non-fix diff is one feature, read in full: member/manager-visible
event organizer names.** `events.py` gained `_resolve_display_names` /
`_names_to_resolve` (batched, org-scoped `User` lookup keyed by response
field so the organizer and the finalizer don't collapse onto one another) and
wired `created_by_name` onto `GET /{event_id}` and
`get_check_in_monitoring_stats` (an `outerjoin` constrained to
`creator.organization_id == Event.organization_id`, so a `created_by`
pointing outside the org resolves to no name rather than naming a
stranger). Both gate the field the same way: `get_event`'s `created_by_name`
resolves only for a caller holding `events.manage`
(`_names_to_resolve` — the gate lives server-side because this endpoint's
response is cached client-side, so a field withheld only in JSX would still
ship to every member); `get_check_in_monitoring_stats` sits entirely behind
its own `events.manage`-gated route, so presence alone is the only condition
worth checking there. `_build_event_response` never populates
`created_by_name` at any of its other six call sites (`list_events`,
`create_event`, `update_event`, `duplicate_event`, `cancel_event`,
`finalize_attendance`, `end_event`) — confirmed by grep, not inferred — so
the field defaults to `None` everywhere except the one gated detail read.
Frontend: `EventDetailPage.tsx`, `EventCheckInMonitoringPage.tsx`,
`EventCheckInModal.tsx`, `EventOverrideAttendanceModal.tsx` thread the same
string through as a plain prop with no independent fetch; the check-in
monitoring page also gained a full-response shape guard (rejects a payload
missing any required field rather than rendering blank totals) and switched
its QR-check-in-data fetch to `_skipCache: true` (a staleness fix — the
90s stale-while-revalidate window could show a closed check-in window as
still open — not a security change). No new endpoint, no new unauthenticated
route, no change to any org-scoping or permission gate. **Verified good, no
finding.**

`forms_service.py`'s diff is the Forms module's own deadlock-retry fix for
`submit_public_form` (an InnoDB gap-lock collision between two first-ever
submissions to two _different_ no-repeat forms, same shape as FAC-45/MSG-13)
— it touches `_process_integrations`'s caller, the function this feature's
`_process_event_request` hooks into, but not that hook itself. Owned by the
Forms feature's own rotation entry, not re-litigated here; confirmed by
reading it that the retry loop re-runs `get_form_by_slug` and the intake
guards but calls `_process_integrations` (and therefore
`_process_event_request`) at most once per successful commit, so this
feature's intake path is not exposed to a double-processed submission by the
retry.

### Route inventory re-run from scratch (AST walk, not diff)

56/56 routes in `events.py` (one more than pass 3's stated "55/55" — no
`@router` line was added or removed since `7af79795`, so this is pass 3's
count being off by one, not a regression; re-verified by grepping `@router\.`
occurrences directly) and 23/23 in `event_requests.py`, both matching the
prior passes' route sets exactly. Every route's `Depends(...)` and
`require_permission(...)`/`require_all_permissions(...)` arguments extracted
programmatically and diffed against pass 3's inventory: identical gates
throughout. No new unauthenticated route. The five public/low-auth routes
are the same ones prior passes named: `events.py`'s
`GET /public-calendar` (no dependency); `event_requests.py`'s
`POST /public` (`_rate_limit_public_request` → `require_captcha`, in that
order — EV-18's fix re-confirmed still in place), `GET /status/{token}`,
`POST /status/{token}/cancel`, and `GET /types/labels`.

### Re-verified from pass 3, not re-derived

- **EV-23 still open, unregressed.** `rsvp_to_series` still passes
  `override=True` unconditionally to every occurrence
  (`event_service.py:1777`), with the same comment claiming a confirmation
  that does not exist anywhere in the series path. Confirmed no frontend or
  backend change since pass 3 touches this — `event_service.py`'s diff this
  round is entirely the organizer-name feature above, nowhere near
  `rsvp_to_series`. Left **FLAGGED**, unchanged from pass 3's reasoning
  (a series spanning multiple training phases has no single-valued "the"
  warning without a product decision on which occurrence it warns for).
- **`ondelete="SET NULL"` nullability** — re-grepped all 8 such FKs across
  `models/event.py` and `models/event_request.py`; all `nullable=True`.
- **No `.like()`/`.ilike()` anywhere in this feature's four backend files** —
  re-confirmed by grep.
- **No CSV export** — `import_events_csv` remains an import
  (`csv.DictReader`), not an export; `SafeCsvWriter` does not apply.
- **RSVP capacity locking, both halves of Pitfall #27**, re-read at their
  current line numbers in `create_or_update_rsvp` and `promote_from_waitlist`
  — event-row lock, then a locking capacity read, before the waitlist
  decision, at both sites.
- **Events-specific MCP tools** (`app/mcp/tools/events.py`,
  `app/mcp/tools/writes.py`) — byte-identical to pass 3 (`git diff --stat`),
  no re-read needed.
- **Frontend banned-pattern sweep** re-run over the 24 files that changed
  since pass 3 (`window.confirm`/`alert`/`prompt`, `dangerouslySetInnerHTML`,
  the three banned `.toLocale*` methods, a `date-fns` import, a direct
  `fetch(` call, `localStorage`) — zero hits beyond the same two
  already-sanctioned `EventsPage.tsx` filter-preset uses pass 2 named.

## Findings (pass 4)

### EV-24 — P2 (fairness/ordering, not tenancy or capacity-correctness) — resubmitting an already-waitlisted RSVP could promote it ahead of an earlier-queued party — ✅ FIXED

**What:** flagged, not fixed, in pass 3. `create_or_update_rsvp`'s capacity
check only ever asked "does _this_ party fit the current gap" — including
when `existing_rsvp` was already `WAITLISTED` and the member was merely
resubmitting (editing notes, e.g., via the modal's prefilled reopen).
`promote_from_waitlist` itself never promotes anyone while an earlier,
ever-admissible party is still queued, even one that does not currently fit
("first in line stays first in line" — the queue query's own
comment/test), but the direct-resubmission path never asked that question
at all.

**Where:** `app/services/event_service.py`, `create_or_update_rsvp`
(capacity-decision block, was `event_service.py:1477-1480` at pass 3).

**Failure scenario:** an event caps at 3 seats. Member A holds all 3 with a
party of 3 (self + 2 guests). Member B (needing 3 seats) and Member C
(needing 1) both RSVP "going" while the roster is full and are both
waitlisted, B first. Member A then shrinks their own party to 1, freeing 2
seats — the automatic promotion loop correctly checks B (head of the queue,
needs 3) and refuses, since a 2-seat gap can't hold a 3-seat party, and
leaves both B and C waitlisted. Member C now reopens their own RSVP modal
and resubmits without changing anything. Before this fix: their 1-seat party
fits the 2-seat gap, so the plain capacity check promoted them straight to
`going` — ahead of B, who has been waiting longer for exactly those seats,
and whose position the member-facing UI (`user_waitlist_position`) explicitly
showed as ahead of C's.

**Impact:** LOW/MED, as scoped in pass 3 — a fairness/ordering defect, not a
tenancy or capacity-correctness one. The event is never oversubscribed by
this path (C's party still has to fit), and it cannot be triggered by a
party larger than the actual free capacity. The harm is queue-jumping: a
member gets promoted out of turn by the accident of reopening their own
modal, while the person actually next in line keeps waiting with no
indication anything happened.

**Fix:** when an existing `WAITLISTED` row is being resubmitted with status
`going` and the plain capacity check would otherwise let it through, a second
locking read asks whether any _other_ `WAITLISTED` row for the same event has
an earlier `responded_at` and is ever-admissible
(`1 + guest_count <= event.max_attendees` — the identical filter
`promote_from_waitlist`'s own queue query uses, so the two never disagree on
what "admissible" means). If one exists, the resubmission stays waitlisted;
the ordinary promotion path decides when it is actually this row's turn.
Scoped deliberately to _resubmissions of an already-waitlisted row_
(`existing_rsvp is not None and old_status == "waitlisted"`) — a brand-new
member's first RSVP taking an open seat is not "jumping" anything, since
they never held a queue position to skip ahead from; extending the guard to
new RSVPs would freeze every open seat behind any large waitlisted party
indefinitely, which is not what was reported and is a materially different
(and arguably worse) behavior change. The added read only ever runs when the
plain capacity check would otherwise succeed (`would_fit`), so it costs
nothing on the already-common "doesn't fit anyway" and "brand-new RSVP"
paths, and it locks (`with_for_update()`, `no_autoflush`) inside the same
per-event serialized transaction `create_or_update_rsvp` already holds —
no new lock-ordering surface, since only one call for a given event can be
inside this function at a time (Pitfall #22/#27 already covers the class of
bug a second lock could introduce; this one adds no new lock target beyond
the `event_rsvps` rows already touched by the existing capacity query).

**Guard tests:**
`tests/test_event_lifecycle.py::TestEventRSVP::test_resubmitting_a_waitlisted_rsvp_cannot_jump_the_queue`
reproduces the exact scenario above end-to-end against a real database (3
users, real capacity/waitlist mechanics, deterministic `responded_at`
ordering via an explicit `UPDATE`) — confirmed to fail
(`assert 'going' == 'waitlisted'`) against the pre-fix code and pass with
it. `tests/test_event_rsvp_waitlist.py::TestResubmittingAWaitlistedRsvpCannotJumpTheQueue`
(7 cases, mocked DB) covers: the core block: an earlier admissible row
blocks the resubmission (confirmed to fail pre-fix); no earlier row lets it
through; an earlier row too big for the _whole event_ does not block
(mirrors `promote_from_waitlist`'s own admissibility filter); a brand-new
RSVP never triggers the extra query (asserts the exact query count); editing
an already-`going` RSVP never triggers it either; a resubmission that
wouldn't fit regardless skips the query entirely; and a structural check
(mirroring `TestPromoteFromWaitlist::test_the_queue_query_excludes_parties_
that_can_never_fit`'s own pattern) that the admissibility filter and the
`responded_at` ordering clause are actually present in the source, since a
mocked DB never executes the real SQL predicate — confirmed to fail pre-fix
(both the core-block test and the structural test).

**Codex review follow-up (same PR, #2451): tied `responded_at` had no
consistent tiebreaker.** Production MySQL stores `responded_at` as a
second-precision `DATETIME`, so two RSVPs queued within the same second tie
on that column alone — routine, not a rare edge case (the guard test above
sidesteps it on purpose, assigning distinct timestamps). Under a tie, the
admission guard's `<` predicate found neither tied row "earlier" than the
other, and `promote_from_waitlist`'s own `order_by(responded_at.asc())`
carried no secondary key either — so which of two tied rows counted as
"ahead" could disagree between the guard, promotion, and the position
displayed to the member (`events.py`'s `user_waitlist_position`, sorted in
Python). Fixed by adding `EventRSVP.id` as a second, deterministic sort key
in all three places: the guard's earlier-row predicate becomes
`responded_at < X OR (responded_at == X AND id < X.id)`; `promote_from_
waitlist`'s query gains `.order_by(responded_at.asc(), id.asc())`, matching
the same tiebreak `list_event_rsvps`'s own going-roster query already used;
and the endpoint's Python `sorted(...)` sorts on `(responded_at, id)`
instead of `responded_at` alone. The id order does not correspond to
arrival order (ids are random UUIDs, not sequential) — that is not the
point: the fix only needs the three sites to agree with each other on
_some_ order, not to reconstruct real-world arrival order for a genuine
tie, which no stored column can recover after the fact.

**Guard test:**
`tests/test_event_lifecycle.py::TestEventRSVP::test_tied_responded_at_uses_id_as_a_consistent_tiebreaker`
forces two waitlisted rows to an exact, microsecond-stripped tie (matching
the second-precision `DATETIME` column) and confirms a consistent order
holds through both automatic promotion and a direct resubmission of the
tiebroken-behind row. Two non-obvious gotchas surfaced writing it, both
about the SQLAlchemy identity map, not the fix itself: (1) a raw `UPDATE`
that bypasses the ORM leaves already-loaded Python objects holding stale
attribute values for the rest of the transaction (the same class of gotcha
`get_shift_by_id`'s `populate_existing` works around) — worked around by
mutating the loaded ORM objects directly instead of raw SQL; (2) the
in-memory tied timestamp must have `microsecond=0` to actually match what
MySQL stores after truncating a second-precision column — otherwise the
un-truncated bind parameter compares as strictly greater than the
truncated stored value, an artificial inequality with nothing to do with
the tiebreaker under test. Both are why the test initially passed against
the **unpatched** code (a false pass) before these were found and fixed;
confirmed genuinely failing against the pre-fix code
(`assert 'going' == 'waitlisted'`, since a tied resubmission was wrongly
promoted) once both were corrected, and passing against the fix.

## Completion gate (pass 4)

| Check                                             | Result                                                     |
| ------------------------------------------------- | ---------------------------------------------------------- |
| `flake8 app/ tests/ alembic/`                     | ✅ 0 violations                                            |
| `black --check app/ tests/ alembic/`              | ✅ 1564 files unchanged                                    |
| `isort --check-only app/ tests/ alembic/`         | ✅ clean                                                   |
| `python3 scripts/validate_migrations.py --strict` | ✅ single head, 441 revisions (no schema change this pass) |
| `pytest tests/ -k "event"`                        | ✅ 714 passed, 1 skipped (pre-existing), +9 new            |
| `pytest tests/` (full backend suite)              | ✅ 12066 passed, 21 skipped (pre-existing), 0 failed       |
| `tsc --noEmit`                                    | ✅ 0 errors                                                |
| `eslint .`                                        | ⚠️ see note below                                          |

**ESLint note:** a direct `npx eslint .` in this sandbox produced 1382
warnings, all `@typescript-eslint/no-unsafe-*` — a broad type-resolution
failure, not a real regression, and not evidence of anything wrong in this
feature's own files. Investigated rather than dismissed, because CLAUDE.md's
"Two TypeScript installs" section predicts exactly this symptom from exactly
this cause: `frontend/package.json` declares the plain `typescript`
dependency at `7.0.2` (current `main`, `26613a59`), not the `5.9.3` that
section's table says it should be, and `package-lock.json` confirms the
`5.9.3` `typescript-eslint` actually type-checks against
(`node_modules/typescript`) is present **only** as an auto-installed peer
dependency (`"peer": true` in the lockfile) satisfying `typescript-eslint`'s
own `<6.1.0` peer range — not as anything any `package.json` in the repo
explicitly requests. That is the precise shape CLAUDE.md's account of the
2026-08-17 break describes ("left the linter running on a 5.9.3 that no
manifest asked for, surviving only as an npm-auto-installed peer"). Whether
this specific committed lockfile is still regenerable from scratch
(`rm package-lock.json && npm install`) was **not** tested here — a full
reinstall against this sandbox's shared `node_modules` is outside this
feature's scope and risky in a multi-session environment — so this is
reported as a verified documentation/manifest mismatch with the same
symptom shape as the prior break, not as a confirmed repeat of it. The most
recent CI run on `main` (`26613a59`, the exact commit this pass branched
from) shows **"Frontend Lint, Typecheck & Build" green** — `npm ci` against
the current, already-resolved lockfile works today regardless of how that
resolution happened. Confirmed no Events & Requests file participates in the
underlying divergence: the events-owned frontend diff for this pass
(`EventDetailPage.tsx`, `EventCheckInMonitoringPage.tsx`, the two attendance
modals, the two skeleton/breadcrumb-only page diffs) contains no banned
pattern by direct grep, independent of ESLint's type-aware rules — and
`tsc --noEmit` (which resolves the aliased `typescript-native` compiler
explicitly via `scripts/tsc-native.mjs`, sidestepping this exact ambiguity)
ran clean.

**Resolved (2026-09-10), via #2452 and the PR #2454 bookkeeping pass:** the
1,382-warning symptom traced above is gone. `frontend/package.json`'s plain
`typescript` is pinned back to `5.9.3` (PR #2452), and a clean `npm ci`
against the committed lockfile now runs `eslint .` with zero output — not
merely under the configured `--max-warnings 10` threshold, but genuinely
zero. See CLAUDE.md's "Two TypeScript installs" section and
`docs/KNOWN_LIMITATIONS.md` for the current state, including the separate,
still-open `npm ls typescript` `ELSPROBLEMS` finding that pin did not close
(escalated, not blocking any build/test path).

## Flagged for owner decision (unchanged from pass 3)

### EV-23 — P2 — series RSVP never shows the training phase-gate warning it claims to have already confirmed — OPEN, re-verified unregressed

No code change since pass 3; see pass 3's write-up above for the full
scenario and recommendation. `docs/KNOWN_LIMITATIONS.md`'s existing EV-23
entry still applies unchanged.

## New, cross-cutting (not an Events & Requests finding — flagged for the

## owner / a dedicated pass, not fixed here)

### `frontend/package.json`'s `typescript` declaration no longer matches CLAUDE.md's documented arrangement

**What:** CLAUDE.md's "Two TypeScript installs" section requires the plain
`typescript` dependency to stay at `5.9.3` (what `typescript-eslint` can
actually type-check against) with `typescript-native` carrying the newer
compiler under an alias, and states that arrangement is what keeps the
lockfile regenerable. `frontend/package.json` (current `main`, `26613a59`)
instead declares `"typescript": "7.0.2"` directly — the same version that
section's own account says broke this arrangement on 2026-08-17 — and
`package-lock.json`'s workspace entry for `frontend` agrees (`"typescript":
"7.0.2"`, matching `package.json` exactly, so the two are not out of sync
with each other). The `5.9.3` that `typescript-eslint` actually runs
against is real and present in the lockfile
(`frontend/node_modules/typescript` nests `7.0.2` for frontend's own
declared need; the top-level `node_modules/typescript` resolves `5.9.3`
marked `"peer": true`) — but that `5.9.3` is there only because npm
auto-installed it to satisfy `typescript-eslint`'s `<6.1.0` peer range,
not because any manifest asks for it by name. That is the exact shape
CLAUDE.md's account of the prior break describes.

**Where:** `frontend/package.json:77` (declaration);
`package-lock.json:11029` and `:211` (the two resulting resolutions).

**Not confirmed broken today, and not necessarily a regression at all** — a
fresh `npm install` from this exact `package.json`/`package-lock.json` pair
was not attempted (see the completion-gate note above for why), so whether
it would reproduce the 2026-08-17 ERESOLVE failure, or successfully nest the
same way the current lockfile already does, is unverified either way. CI's
`npm ci` against the committed lockfile is green. It is possible this is a
deliberate, working step toward eventually dropping the alias (both
`typescript` and `typescript-native` now request the same `7.0.2`) rather
than an accidental drift — but if so, CLAUDE.md's documented table and its
"the plain `typescript` moves only when the linter's cap does" rule are now
describing an arrangement the manifest no longer follows, which is itself
worth reconciling one way or the other.

**Not an Events & Requests defect** — cross-cutting frontend tooling, and CI
is currently green on `main` (a fresh `npm ci` there does not (yet)
reproduce the local symptom this pass hit), so this is not blocking. But it
is exactly the regression CLAUDE.md predicts one Dependabot bump away from
recurring, and a `package.json`/`package-lock.json` pair in this state is
one `npm install`/lockfile regeneration away from becoming un-regenerable.
**Flagged, not fixed here** — out of scope for a single-feature
security-review PR, and the correct fix (pin `typescript` back to `5.9.3`
in `package.json`, per CLAUDE.md's own rule "the plain `typescript` moves
only when the linter's cap does") touches shared tooling config, not this
feature's code. Mirrored in `docs/KNOWN_LIMITATIONS.md`.

**Resolved (2026-09-10), PR #2452:** `frontend/package.json`'s `typescript`
is pinned back to `5.9.3`, closing the manifest/lockfile drift this section
flagged. A distinct, narrower finding surfaced during that fix's
verification — `npm ls typescript` reports `ELSPROBLEMS` because
`frontend/node_modules/typescript` still nests `7.0.2` even with the pin
correct — and remains open, escalated (not a regression of this finding;
see CLAUDE.md's "Two TypeScript installs" section and
`docs/KNOWN_LIMITATIONS.md` for detail).

---

## Pass 3 (2026-09-04) — Codex follow-up, two rounds: 4 fixes (3 P1), 2 flagged, 1 scope correction

**PR:** [#2213](https://github.com/thegspiro/the-logbook/pull/2213) merged
at its stale first-draft state before this correction could be pushed to
it (CLAUDE.md pitfall #24 — see `PROGRESS.md`'s Log for detail); the
correction below and its fixes carried forward on a new branch/PR,
`claude/security-review-events-ev20-24-followup`.
**Scoped since pass 2's merge:** `fef19238` (PR #1973).

> **Correction (Codex review of PR #2213).** The first draft of this section
> claimed "no new findings, no code changes" — that was wrong. Codex raised
> six comments against it; five are real (two P1 correctness/data-loss bugs
> this draft's own "narrowing, not a new exposure" line had missed or
> surfaced without fixing, one P2 schema gap, one P2 scope gap, one P2
> ordering bug flagged rather than fixed) and one (the phase-gate finding)
> is real but flagged, not fixed, for the reason given under
> **Findings (pass 3)** below. The section below is the corrected one; see
> `PROGRESS.md`'s Log for the blow-by-blow.

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
note still gets it cleared. `RSVPCreate.notes` widened to `string | null |
undefined` in `types/event.ts` to carry the explicit null.

**Guard test:**
`test_event_lifecycle.py::TestEventRSVP::test_update_preserves_omitted_accommodation_fields`
— sets both fields, then submits an update that only changes `guest_count`
and asserts both survive unchanged; a third submission that explicitly
sends `dietary_restrictions=""` confirms an actual edit still clears it
(exclude_unset protects an _omitted_ field, not one the client genuinely
changed).

**Second round (Codex review of the follow-up PR): two more real gaps in
this same fix.**

1. **P1 — capacity/guest checks kept reading the raw request value, not
   what would actually end up stored.** `create_or_update_rsvp`'s
   `allow_guests` check, party-size guard, and the occupied-seats capacity
   sum all read `rsvp_data.guest_count` directly. Before this fix that was
   always correct, because the old full-dump update meant the request
   value and the stored value were the same thing by construction. After
   exclude_unset, they can genuinely diverge: a client that omits
   `guest_count` on an update now has it preserved from the existing row
   (correct for the write), but every guest/capacity check still evaluated
   the omitted-and-therefore-zero-defaulting request value instead — so a
   waitlisted three-seat party resubmitting `{"status": "going"}` (omitting
   `guest_count` entirely) would be evaluated as a one-seat party, wrongly
   promoted into a two-seat gap, while the row silently kept its real
   three-seat `guest_count` — oversubscribing the event by the difference.
   Not reachable through this app's own RSVP modal (`useRSVPForm.ts`
   always sends `guest_count` explicitly), but reachable by any other API
   client, and the check that exists to prevent oversubscription must not
   depend on which client is calling it.

   **Fix (EV-25 — P1):** the `existing_rsvp` fetch moved earlier in the
   function (ahead of the guest/capacity guards, not just ahead of the
   update-application branch), and a single `effective_guest_count` is
   resolved once — the incoming value when the client actually sent one
   (`"guest_count" in rsvp_data.model_fields_set`, or always for a brand
   new RSVP), otherwise the value already on the row. Every guest/capacity
   check (`requested_guests`, `party_size`, `requested_seats`) now reads
   this resolved value instead of `rsvp_data.guest_count` directly; the
   decline branch's forced `guest_count: 0` sets `effective_guest_count = 0`
   alongside it, so the two never disagree. Guard test:
   `test_event_lifecycle.py::TestEventRSVP::
test_partial_update_uses_the_stored_guest_count_for_capacity` —
   reproduces the exact scenario (a 3-seat waitlisted party resubmitting
   with `guest_count` omitted must stay waitlisted, not get promoted into a
   2-seat gap); confirmed to fail without the fix before being committed
   with it.

2. **P2 — no interaction in the modal could actually clear a saved
   accommodation field.** The first round's omit-when-blank behavior for
   `dietary_restrictions`/`accessibility_needs` is correct for the
   "member didn't touch this field" case, but the modal has no other state
   to distinguish that from "member touched it and emptied it on purpose" —
   both looked like a blank box being submitted. The net effect: once a
   member had a saved allergy or accessibility note, nothing in this modal
   could ever remove it again, only overwrite it with different non-empty
   text.

   **Fix:** `useRSVPForm.ts` now tracks `dietaryTouched`/
   `accessibilityTouched` per field — set the moment the member's `onChange`
   fires for that field, reset (to untouched, alongside the value) whenever
   the modal opens. The submit payload includes `dietary_restrictions`/
   `accessibility_needs` (with an explicit `null` if left empty) only when
   the corresponding field was touched this time the modal was open;
   otherwise the key is omitted exactly as before, still relying on
   `exclude_unset` to leave the stored value alone. `RSVPCreate`'s two
   fields widened to `string | null | undefined` in `types/event.ts` to
   carry the explicit clear.

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
| `pytest tests/ -k "event"`                                    | ✅ 674 passed, 1 skipped (pre-existing)              |
| `pytest tests/` (full backend suite)                          | ✅ 10554 passed, 21 skipped (pre-existing), 0 failed |
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
