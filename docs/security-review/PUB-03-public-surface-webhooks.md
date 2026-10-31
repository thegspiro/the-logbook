# Security Review — Public Surface & Webhooks

**Prefix:** `PUB` · **Iteration:** 03 · **Reviewed:** 2026-08-25 (pass 1), 2026-08-27 (pass 2), 2026-09-01 (pass 3), 2026-09-08 (pass 4), 2026-09-14 (pass 5), 2026-09-15 (pass 6), 2026-10-05 (pass 7), 2026-10-12 (pass 8), 2026-10-14 (pass 9, watchdog pickup), 2026-10-18 (pass 10, watchdog pickup), 2026-10-22 (pass 11, watchdog pickup), 2026-10-25 (pass 12), 2026-10-28 (pass 13, watchdog pickup), 2026-10-31 (pass 14, watchdog pickup) · **PR:** #1806 (pass 1), pass 9 (PR #3215), pass 10 (PR #3399), pass 11 (PR #3558), pass 13 (PR #3804), pass 14 (this PR)

---

## Pass 14 (2026-10-31, watchdog pickup) — a new public Follow-up Form surface reviewed fresh; two write/read inconsistencies found and fixed (PUB-13, PUB-14); route count corrected to 48

Watchdog pickup — the dedicated `/loop 30m /security-review` session
(`session_011T1ZyyLrD5HagusgK9uDw2`) remains unreachable, confirmed via
`ListAgents`. Step 0: `list_pull_requests`/`search_pull_requests`
(`is:open` against the repo, and `head:claude/security-review-`) found 0
open security-review PRs — PR #3871 (Feature 02, Permissions & roles,
pass 14) had already merged (`f9220b364`). Row 03 confirmed the next `⬜`
row on a freshly-fetched `main`.

**Baseline:** `d2cd227f` (pass 13's merge, PR #3804). **Head:** `ffcced29d`
(277 commits, 180 non-merge). `git diff d2cd227f HEAD --stat --
backend/app/api/public/ backend/app/core/public_portal_security.py
backend/app/services/integration_services/webhook_service.py
backend/app/utils/webhook_replay.py` touches **three** files:
`display.py` (+5/-5), `portal.py` (+10/-7) and a brand-new
`follow_up_forms.py` (126 lines). The three webhook receivers
(`paypal_webhook.py`, `integrations_webhook.py`, `salesforce_webhook.py`),
`public_portal_security.py`, `webhook_service.py`, `webhook_replay.py` and
the other eleven route-bearing files under `app/api/public/` are
byte-identical to pass 13's reviewed state (same diff command, no hunks).

**Route re-enumeration (per Step 3's instruction that a repeat pass
re-derives the count rather than trust it forward):** an AST walk of every
`@router.<verb>` decorator across all 15 route-bearing files under
`app/api/public/` (`responses.py` and `__init__.py` excluded — neither
defines a route), cross-checked against a plain
`grep -c '^@router\.\(get\|post\|put\|patch\|delete\)'` (both methods
agreeing), finds **48 routes**: pass 13's 45 plus the 3 new
`follow_up_forms.py` routes (`display.py` and `portal.py` gained no new
routes this pass, only logic changes inside existing handlers). Every
router import was cross-checked against `backend/main.py`'s
`app.include_router(...)` calls by its actual import alias (e.g.
`public_follow_up_forms_router`) rather than by filename substring, since
several aliases do not contain the module's own name
(`finance_approvals_router`, `sf_webhook_router`) — all 15 are mounted,
none orphaned.

**The new surface, read in full against all seven checklist dimensions:**

- **`app/api/public/follow_up_forms.py` (new, 3 routes, prefix
  `/public/v1/follow-up-forms`) and its collaborator
  `app/services/follow_up_form_service.py`** — a Follow-up Form pipeline
  stage emails an applicant a personal link (`GET /{token}`,
  `PUT /{token}/draft`, `POST /{token}/submit`) to fill in a form with no
  sign-in. **Auth (dimension 1):** intentionally public; every handler
  calls `validate_ip_rate_limit(request)` as its first line, ahead of any
  DB work, reusing the already-reviewed shared public-portal IP limiter
  (keyed on `get_client_ip`, not the proxy peer — PP-4/AXC-1's fix).
  **Token handling:** the 43-char token (`secrets.token_urlsafe(32)`) is
  looked up only by `token_hash` (SHA-256, `ProspectFormRequest.token_hash`,
  unique-indexed) via `FollowUpFormService.resolve`; the plaintext `token`
  column is `EncryptedText`, kept only to repeat an identical link on
  resend, and a `@validates("token")` hook keeps `token_hash` in sync so
  there is no path that writes one without the other
  (`models/membership_pipeline.py:1025-1028`). **Tenant isolation
  (dimension 3):** `resolve()` takes `organization_id` only from the row
  the token names (`request.organization_id`), never from the client, and
  every subsequent query (`prospect`, `step`, `form`) is filtered by it
  directly rather than trusting the parent chain alone — belt-and-suspenders,
  matching this feature's established shape. **Abuse resistance
  (dimension 6):** `PublicFollowUpAnswers.data` is capped at 500 answers
  (`_FOLLOW_UP_MAX_ANSWERS`) and each stored value is cut to
  `FormsService.MAX_TEXTAREA_LENGTH` (50,000 chars) on save; the
  already-reviewed app-wide `RequestSizeLimitMiddleware` (pure ASGI, fast-path
  Content-Length check plus a streamed-byte ceiling) bounds the request body
  regardless, so an unbounded single field cannot be used for memory
  exhaustion ahead of that truncation. **Idempotency (Pitfall #36):**
  `_get_or_create_request` resolves the one row per `(prospect_id,
step_id)` behind a unique index (`uq_prospect_form_request_step`), with
  an `IntegrityError` fallback that re-reads the winner — two racing sends
  (stage-entry auto-send and a coordinator's manual Send now) cannot issue
  two tokens. `submit()` row-locks the request and the prospect
  (`with_for_update`) and resolves the already-submitted state as a
  distinguished `FollowUpAlreadySubmitted` rather than a second write.
  **Data exposure (dimension 5):** a field marked `is_sensitive` is never
  mapped onto the applicant record (`_record_updates` skips it) and never
  echoed back as a pre-filled value (`public_view`'s loop excludes
  `field.is_sensitive`), so a restricted answer cannot round-trip onto a
  record every pipeline viewer reads. An email change that collides with
  another open application is recorded for a coordinator rather than
  applied or disclosed to the submitter — the same no-oracle shape this
  feature uses elsewhere. The two reminder/notification paths
  (`send_due_reminders`, `_notify_coordinators_of_submission`) commit per
  row and log-and-continue on failure, so one bad row cannot take out a
  whole run. **Schema & migration integrity (dimension 7):** two new
  migrations, read in full — see below.
- **Migrations `f34e25e2c820` (table + enum widenings) and `30e5b112ec00`
  (reminder columns), read in full:** both are idempotent (`_has_table`/
  `_has_column` guards; "safe to run twice" per their own docstrings), skip
  the table entirely when `create_all` would build it instead (Pitfall
  #26), and freeze the enum value lists they widen as literal tuples rather
  than importing the live enum (Pitfall #20's "frozen" requirement — a
  later edit to `EmailTemplateType` cannot rewrite what these revisions
  did). Every `ondelete="SET NULL"` column on the new
  `prospect_form_requests` table (`step_id`, `form_id`, `submission_id`,
  `contact_change_reviewed_by`) is `nullable=True` (Pitfall #2); the new
  `reminder_count` is `NOT NULL` with a `server_default` (Pitfall #35).
  The downgrade for `f34e25e2c820` refuses while any pipeline stage is
  still typed `follow_up_form`, rather than silently truncating those
  rows — fails loudly, the correct direction per Pitfall #35's "settle
  the rows that exist" principle where there is no sensible auto-settle.
- **`app/api/public/portal.py`'s `get_organization_stats` (no new route;
  existing handler's body changed, +10/-7)** — a data-correctness fix
  (W76-6, a workflow-review finding outside this rotation, matching how
  pass 12 handled W76-2 in the same file): `total_volunteer_hours`,
  `total_calls_ytd` and `stations` published `null` unconditionally; they
  now compute real values via the new `app/services/public_stats_service.py`.
  Re-checked against this feature's own scope rather than deferred: the
  route is still gated by `Depends(authenticate_api_key)` (API-key auth,
  IP-rate-limited inside that dependency ahead of any DB work — PP-4,
  unchanged) and `organization_id` is taken only from
  `api_key.organization_id`/the resolved `org` row, never client-supplied.
  All four new aggregate queries in `public_stats_service.py` are
  org-scoped directly (`AdminHoursEntry.organization_id`,
  `OrgCall.organization_id`, `Facility.organization_id`) or through an
  org-filtered join to the owning row (`ShiftAttendance` → `Shift`,
  `EventRSVP` → `Event`) — no raw SQL, no client-supplied id anywhere in
  the four functions. The assembled `stats_data` dict still passes through
  `filter_data_by_whitelist(...)` before the response model validates it
  (PUB-6's guard, unchanged), so a department that has not whitelisted a
  field still gets it stripped regardless of this fix. All four queries
  are bounded aggregates (`COUNT`/`SUM`), not per-row loops, so dimension
  6 is unaffected; the endpoint's existing 100/hour per-API-key quota
  (PUB-5/PUB-5b) still runs ahead of them.

**PUB-13 (LOW, FIXED) — the guest sign-in info endpoints still reported
`is_open: true` after attendance was finalized, disagreeing with the write
path.** Commit `9458cb316` (2026-10-28, landed inside this pass's review
window) introduced `GuestCheckInService.guest_sign_in_state` — the window
check plus the attendance-finalized lock, as one definition — and switched
`display.py`'s `_assert_guest_sign_in_open` (the write guard) and the
manager's authenticated guest-link card endpoint
(`api/v1/endpoints/events.py:3028`) to it. It did not switch the two public
_info_ endpoints the sign-in page itself reads before deciding whether to
show the form at all: `display.py`'s `get_guest_check_in_info` (kiosk path,
line 458) and `event_guest.py`'s `get_link_guest_check_in_info` (event-link
path, line 110) were left calling the narrower `check_in_window_state`,
which knows nothing about the attendance lock.

**Impact:** `frontend/src/pages/GuestCheckInPage.tsx:233` renders the
sign-in form whenever `info.is_open` is true and nothing else. Once a
manager finalizes attendance for an event, a visitor opening the same QR
code or kiosk link still saw the form, filled it in, and was refused only
at submission (`_assert_guest_sign_in_open`, 400,
`EVT_CHECKIN_WINDOW_CLOSED`) — a correctness/UX gap rather than a control
bypass, since the write path's own check was never the one missing.
**Fix:** both info handlers now call `guest_sign_in_state` instead of
`check_in_window_state`, matching the write guard and the manager's card.
**Guard tests:** `backend/tests/test_event_guest_link.py`'s
`TestPublicSignIn.test_info_reports_closed_once_attendance_is_finalized`
(integration, real DB, confirmed to fail against the pre-fix code:
`assert True is False`) and
`backend/tests/test_public_display.py`'s new
`TestGuestCheckInInfoReflectsAttendanceLock` (two unit tests, the
finalized case confirmed to fail pre-fix with the same symptom, plus a
control asserting an open window is unaffected).

**PUB-14 (LOW, FIXED) — a follow-up form's personal link token had no
redaction pattern in either the frontend's or the backend's client-error
path-sanitizer, unlike every other public bearer-token workflow.**
`backend/app/core/error_reporting.py`'s `TOKEN_PATH_PATTERNS` and its
frontend mirror, `frontend/src/services/errorReporting.ts`'s
`sanitizePath`, are the fallback redaction `sanitize_path` uses for a
client-reported error path, which (unlike a server-side request) carries
no Starlette `path_params` to redact by parameter name. Both lists already
cover `/event-guest/`, `/display/`, `/application-status/` and others —
the exact same class of bearer-credential path — but neither gained an
entry for this pass's new `/application-form/{token}` page route or its
`/follow-up-forms/{token}` API. **Impact:** `errorTracking.ts` captures
`window.location.pathname` on any client-side error and
`errorReporting.ts`'s `reportApiError` captures the failed request's own
URL on any failed API call; either one, reported from the applicant's
form page, would have written the bearer token in clear text into
`error_logs` — a table every `audit.view` holder can read and export as
JSON (the exact exposure the existing patterns for `/event-guest/` etc.
already exist to prevent, just not extended to this new route). **Fix:**
added one pattern per side for `/application-form/` and
`/follow-up-forms/`, mirroring the existing entries' exact shape. **Guard
tests:** `backend/tests/test_error_reporting.py`'s
`TestSanitizePath.test_redacts_the_follow_up_form_link_token` and
`frontend/src/services/errorReporting.test.ts`'s two new `it.each` rows in
the `sanitizePath` block — both confirmed to fail against the pre-fix
patterns (asserting the literal token survived) before the fix was
applied.

**RFC 8414/9728 metadata endpoints, the three webhook handlers, and
`mcp_oauth.py`'s rate-limited OAuth routes:** unchanged, byte-identical to
pass 13's already-fully-reviewed state (same diff command, no hunks) —
not re-read line by line this pass, per Step 3's instruction to spend a
repeat pass's reading on what changed.

**Nothing else to fix, nothing else to flag.** PUB-1 through PUB-12 remain
fixed (unaffected by this diff); PUB-3 (INFO, `ApprovalChain`'s tables
remain `create_all`-only, by design) is unchanged and still accurate — no
new migration touches those tables this pass. No `KNOWN_LIMITATIONS.md`
entry needed: both findings are closed, not owner decisions.

### Completion gate (pass 14)

| Check                                                                                                                                                                                                                                                                                                                                         | Result                                                                                                       |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `flake8 app/ tests/ alembic/` (from repo root, `cd backend`)                                                                                                                                                                                                                                                                                  | ✅ 0 violations                                                                                              |
| `black --check app/ tests/ alembic/`                                                                                                                                                                                                                                                                                                          | ✅ 2754 files unchanged (one new test file reformatted by `black` itself, not hand-fixed, before this check) |
| `isort --check-only app/ tests/ alembic/`                                                                                                                                                                                                                                                                                                     | ✅ clean                                                                                                     |
| `python3 scripts/validate_migrations.py --strict`                                                                                                                                                                                                                                                                                             | ✅ single head `c588f525fdbb`, 679 revisions                                                                 |
| `python3 scripts/check_route_permissions.py --strict`                                                                                                                                                                                                                                                                                         | ✅ 281 routes, 0 errors, 0 warnings                                                                          |
| scoped pytest (`-k "public or webhook or paypal or salesforce or integrations or minutes or mcp_oauth or calendar or finance_approval or branding or kiosk or guest or event_guest or embed or legal or display or security_txt or portal or next_meeting or follow_up or error_reporting" -m "not integration and not slow and not docker"`) | ✅ 1629 passed, 1 skipped (`pywebpush`, pre-existing)                                                        |
| `cd frontend && npm run typecheck`                                                                                                                                                                                                                                                                                                            | ✅ 0 errors                                                                                                  |
| `cd frontend && npm run lint`                                                                                                                                                                                                                                                                                                                 | ✅ 0 errors, 0 warnings                                                                                      |
| `cd frontend && npx vitest run src/services/errorReporting.test.ts`                                                                                                                                                                                                                                                                           | ✅ 71 passed                                                                                                 |

Rotation row 03 → ✅ (pending this PR's merge); next is Feature 04
(Storefront & payments).

---

## Pass 13 (2026-10-28, watchdog pickup) — a new event-QR guest entrance, a kiosk lookup/confirm mirror, a forms embed-policy endpoint and an applicant calendar download, all reviewed fresh; route count corrected (37, not 40) from re-derivation; 0 fixed, 0 new findings

Watchdog pickup — the dedicated `/loop 30m /security-review` session
(`session_011T1ZyyLrD5HagusgK9uDw2`) remains unreachable, confirmed via
`ListAgents`. Step 0: `search_pull_requests`
(`is:pr is:open head:claude/security-review-`) returned 0 results after PR
#3803 (Feature 02, Permissions & roles, pass 13) merged (`d2cd227f`). Row 03
confirmed the next `⬜` row on a freshly-pulled `main`.

**Baseline:** `e6da6486` (pass 12's merge). **Head:** `d2cd227f`.
`git diff e6da6486 HEAD --stat -- backend/app/api/public/
backend/app/core/public_portal_security.py
backend/app/services/integration_services/webhook_service.py
backend/app/utils/webhook_replay.py` touches **four** files:
`display.py` (+284/-19), a brand-new `event_guest.py` (417 lines), `forms.py`
(+57/-2) and `portal.py` (+51/-2). The three webhook receivers,
`public_portal_security.py`, `webhook_service.py` and `webhook_replay.py` are
byte-identical to pass 12's reviewed state (same diff command, no hunks). No
migration touches a table only this feature's handlers write to; two
migrations in the window add a column this feature's handlers now read
(`guest_check_in_token`) or rely on correct behavior of
(email-at-rest encryption), both reviewed below under Schema & migration
notes.

**Route count correction.** Pass 12 stated 40 routes and showed its
arithmetic (28 after pass 7, +9, +1, +2). Re-deriving directly from the
baseline commit (`git show e6da6486:... | ast-walk`, cross-checked against a
plain `grep -c '^@router\.\(get\|post\|put\|patch\|delete\)'`, both methods
agreeing) finds **37** routes at that commit, not 40 — `display.py` had 4
(not implied higher), `forms.py` 2, `portal.py` 6, and the other ten files
unchanged from their last-reviewed counts. The discrepancy is in a prior
pass's arithmetic, not a hidden or miscounted route in the app itself: no
route is missing from either count. Corrected baseline: **37**. New total
after this pass's additions (`display.py` +2, `forms.py` +1, `portal.py` +1,
`event_guest.py` +4 new file): **45**, independently confirmed by both
methods above against the current head.

**Not the same number as `check_route_permissions.py --strict`'s 279**,
and that is expected rather than a discrepancy to resolve: that script (read
this pass to confirm, rather than assumed from its name) checks **frontend**
routes against `APPLICATION_PAGES.md`, not backend API endpoints — a
different count for a different surface. It is unchanged from PERM-02 pass
13's same-week figure because none of this pass's additions are new frontend
pages; every one of them is a backend endpoint an existing public page (the
event guest-sign-in page, the kiosk display, the embeddable form, the
applicant status page) now calls.

**New public surface, read in full:**

- **`app/api/public/event_guest.py` (new, 4 routes, prefix
  `/public/v1/event-guest`)** — the room-kiosk guest sign-in
  (`display.py`), now reachable through the event's own QR code for a venue
  with no kiosk. `GuestToken` is a 43-char path parameter (matches
  `secrets.token_urlsafe(32)`'s output length) resolved only through
  `Event.guest_check_in_token` (`GuestCheckInService.get_event_by_link_token`,
  `backend/app/services/guest_check_in_service.py:761-785`) — the token
  alone decides the event and, through it, the organization; there is no
  client-supplied org or event id anywhere in this module. Every failure
  mode (malformed token, unknown token, cancelled/draft event,
  `allow_guest_check_in` off) answers the same 404, so the endpoint cannot be
  used to probe which tokens are live. The four handlers **import their
  gates from `display.py` rather than restating them** (`_rate_limit_display`,
  `_rate_limit_guest_check_in`, `_rate_limit_guest_lookup`,
  `_assert_guest_sign_in_open`, `_require_email_first`) — deliberately, per
  the module's own docstring, so the two entrances cannot drift apart and a
  caller gains no allowance by alternating between them. Confirmed identical
  gate functions by reading both modules' imports, not assumed from the
  docstring's claim. A honeypot field (`hp_website`) short-circuits to the
  same plausible success/not-found response bots get elsewhere in this
  feature. Confirm-token binding (`GuestCheckInService.issue_confirm_token` /
  `read_confirm_token`, lines 542-599) is a signed JWT (`HS256`,
  `settings.SECRET_KEY`) carrying `evt`/`loc`/`org` claims checked by exact
  match on read — `loc` is the empty string for this module's calls (vs. an
  actual location id for the kiosk path), so a token issued at a kiosk is
  never accepted through an event link and vice versa; `exp` is a required
  claim with a 10-minute TTL. The per-event daily cap
  (`daily_cap_exceeded`, Redis `INCR`) is spent only after every rejection
  gate, matching the ordering the module's docstring states and
  `display.py`/`event_requests.py` (EV-19) already establish elsewhere in
  this app.
- **`app/api/public/display.py`'s new `guest_lookup`/`guest_confirm`
  (+2 routes)** — the kiosk-side mirror of the same lookup/confirm pair,
  scoped through `_resolve_guest_event` (display code → location →
  event, `organization_id` taken from the resolved `location`, never the
  request) rather than the link token. Same gate ordering, same honeypot,
  same audit-log shape (`event_guest_lookup`/`event_guest_checkin`, email
  itself never recorded — only the outcome and prospect id, matching
  checklist §5's "no PII/PHI in audit payloads"). `GuestLookupService`'s
  underlying `lookup_guest` (`guest_check_in_service.py:492-527`) was
  re-checked against the new email-at-rest encryption (below) rather than
  assumed unaffected because unchanged this pass.
- **`app/api/public/forms.py`'s new `GET /{slug}/embed-policy`
  (+1 route)** — answers nginx's `auth_request` for `/embed/f/<slug>` with
  the `Content-Security-Policy: frame-ancestors` value to apply, read from
  org settings' free-form JSON (`forms.embed_allowed_origins`) and from
  `form.allow_embed`. The value is written into both a response header and
  the response body, so the two inputs that reach it —
  the slug (used only to key a lookup; validated by `SLUG_PATTERN.match`
  before querying) and the stored origin list — were checked for anything
  that could end the header early or inject a second directive.
  `app/utils/embed_origins.py`'s `valid_embed_origins`/`normalize_embed_origin`
  is the gate: an anchored regex (`^https://...\Z`) accepting only a
  lowercase host, optional port, **no path, no wildcard, no character
  outside `[a-z0-9.-:]`** — so no space, semicolon, quote or CRLF can reach
  either the header or the body, and an invalid stored entry is dropped
  (not raised) so one bad entry can't 500 every embedded form in the org.
  Capped at 10 origins. A slug matching nothing, or a form with `allow_embed`
  off, answers `'none'` with a 200 (never a 404/500) — same "no oracle"
  shape as this feature's other public lookups. `Cache-Control: no-store`
  is set so nginx's `auth_request` subrequest is never served a stale
  policy. Rate-limited via the module's existing `_rate_limit_view`
  (unchanged, reused).
- **`app/api/public/portal.py`'s new `GET
/application-status/{token}/next-meeting.ics` (+1 route)** — a calendar
  file for the meeting the applicant's status page already shows, gated by
  the same bearer token as that page
  (`MembershipPipelineService._load_prospect_for_status_page`, matched by
  `ProspectiveMember.status_token_hash == hash_status_token(token)` — a
  hash comparison, not a plaintext lookup) and refused (404) wherever the
  page would show no meeting card, so it discloses nothing the page does
  not. `validate_ip_rate_limit(request)` runs as the handler's first line,
  before any DB work. The filename in `Content-Disposition` is the
  hardcoded literal `"next-meeting.ics"` — never attacker- or
  event-title-influenced, so no header-injection surface there. The ICS
  body is built by the already-reviewed `generate_ical_feed`
  (`app/services/integration_services/ical_service.py`), whose `_escape_ics`
  (lines 124-139) backslash-escapes `\`, `;`, `,` and collapses every CR/LF
  variant to `\n` before `event.title`/location text is interpolated into
  the file — the standard ICS-injection guard, confirmed present and
  unchanged, not merely assumed because this is a GET.

**Email/phone-at-rest encryption's effect on this feature, checked rather
than assumed compatible:** `EventExternalAttendee.email`/`.phone` are now
`EncryptedText` (migration `b8236e29ec44`, below), with a new `email_hash`
column replacing the old plaintext `ix_ext_attendees_email` index. This
feature's only read of attendee email is `GuestCheckInService.lookup_guest`,
which never queries `EventExternalAttendee` at all — it checks
`ProspectiveMember` (through `MembershipPipelineService`, itself migrated to
hash-based lookup under the same revision, out of this feature's file set)
and `User.email_hash.in_(email_fingerprints(normalized))`
(`guest_check_in_service.py:513-523`) — a fingerprint-set match, not a
plaintext comparison, so the encryption migration does not silently break
guest recognition. `check_in_guest`'s write path (which does populate
`EventExternalAttendee.email`) was not re-read in full this pass — it is
unchanged by this diff and was already in scope under a prior pass's
read of `guest_check_in_service.py`; noted here rather than re-claimed as
newly verified.

**RFC 8414/9728 metadata endpoints, PayPal/Documenso/Cal.com/Salesforce
webhook handlers, and the rate-limited-OAuth-server routes (`mcp_oauth.py`):**
unchanged, byte-identical to pass 12's already-fully-reviewed state;
re-confirmed via the same diff command (no hunks) rather than re-read line by
line this pass, per Step 3's instruction to spend a repeat pass's reading on
what changed.

**Nothing to fix, nothing to flag.** Every new or touched route carries a
named compensating control (bearer token, signed confirm token, rate limit,
honeypot, or — for the embed-policy endpoint, which needs none because it
performs no write and discloses only a department's own publish-time
choice — a strict output-origin whitelist). No `KNOWN_LIMITATIONS.md` entry
needed.

### Completion gate (pass 13)

| Check                                                                                                                                                                                                                                                                                                         | Result                                                |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| `flake8 app/ tests/ alembic/` (7.4.1)                                                                                                                                                                                                                                                                         | ✅ 0 violations                                       |
| `black --check app/ tests/ alembic/` (26.10.1)                                                                                                                                                                                                                                                                | ✅ clean                                              |
| `isort --check-only app/ tests/ alembic/` (9.0.2)                                                                                                                                                                                                                                                             | ✅ clean                                              |
| `python3 scripts/validate_migrations.py --strict`                                                                                                                                                                                                                                                             | ✅ single head `0d9897752425`, 666 revisions          |
| `python3 scripts/check_route_permissions.py --strict`                                                                                                                                                                                                                                                         | ✅ 279 routes, 0 errors, 0 warnings                   |
| scoped pytest (`-k "public or webhook or paypal or salesforce or integrations or minutes or mcp_oauth or calendar or finance_approval or branding or kiosk or guest or event_guest or embed or legal or display or security_txt or portal or next_meeting" -m "not integration and not slow and not docker"`) | ✅ 1509 passed, 1 skipped (`pywebpush`, pre-existing) |
| standing guard suites (org-scoping ratchet, capacity locking, CSV sweep, LIKE escaping, `create_all`-table tolerance, DB-schema/`SET NULL`, baseline member grants, endpoint-auth coverage, PII-cache exclusions)                                                                                             | ✅ 208 passed                                         |
| `cd frontend && npm run typecheck`                                                                                                                                                                                                                                                                            | ✅ 0 errors                                           |
| `cd frontend && npm run lint`                                                                                                                                                                                                                                                                                 | ✅ 0 errors, 0 warnings                               |

No `KNOWN_LIMITATIONS.md` change needed — nothing flagged this pass. Rotation
row 03 → ✅ (pending this PR's merge); next is Feature 04 (Storefront &
payments).

---

## Pass 12 (2026-10-25) — re-enumerated all 40 routes by AST, re-verified the three webhook handlers and the one changed file; 0 fixed, 0 new findings

Picked up the rotation at its normal Feature-03 slot. Step 0:
`search_pull_requests` (`is:pr is:open head:claude/security-review-`) returned
0 results, re-confirmed immediately before branching. PR #3685 (Feature 02,
Permissions & roles, pass 12) and PR #3686 (an orphaned-fix recovery for
Feature 30, Onboarding) had both merged minutes earlier, bringing `main` to
`e6da6486`. Rotation row 03 was confirmed the next `⬜` by reading
`PROGRESS.md`'s table directly on a freshly fetched `main` — not from the
rotation note that triggered this iteration.

**Baseline:** `b06de81f` (PR #3558's merge, pass 11). **Head:** `e6da6486`.
`git diff b06de81f e6da6486 --stat -- backend/app/api/public/
backend/app/core/public_portal_security.py
backend/app/services/integration_services/webhook_service.py
backend/app/utils/webhook_replay.py` (18 files: the whole `app/api/public/`
directory, 15 files, plus the three named collaborators) touches exactly
**one** file: `backend/app/api/public/portal.py` (+33/-24). The three
webhook receivers (`paypal_webhook.py`, `integrations_webhook.py`,
`salesforce_webhook.py`), `public_portal_security.py`, `webhook_service.py`,
`webhook_replay.py`, and the other 9 route-bearing files under
`app/api/public/` (plus `responses.py` and `__init__.py`, neither of which
defines a route) are byte-identical to pass 11's reviewed state (confirmed by
the same diff command returning no hunks for each). No migration touches
this feature's tables this pass.

**Route re-enumeration (per this pass's own instruction to re-derive the count
rather than trust it forward):** an AST walk of every `@router.<verb>`
decorator across all 13 route-bearing files under `app/api/public/`
(`responses.py` and `__init__.py` excluded — neither defines a route) finds
**40 routes**, unchanged from the count pass 7–11's additions imply
(28 after pass 7, +9 for `mcp_oauth.py`'s actual decorator count in pass 8,
+1 for `calendar.py`'s org feed in pass 10, +2 for `minutes.py` in pass 11 = 40) and confirmed by cross-checking every router import against
`backend/main.py`'s `app.include_router(...)` calls — all 13 routers (plus the
shared `responses.py` constants module) are mounted, none orphaned. **0 new
routes, 0 removed.** `check_route_permissions.py --strict` separately reports
276 routes app-wide, 0 errors, 0 warnings — identical to SEC-00 pass 12's
same-day whole-app count, confirming neither Feature 02's permissions work nor
this feature's own unchanged files shifted the total.

**The one changed file, read in full rather than trusted from the diff:**

- **`app/api/public/portal.py`, `get_organization_info` (`GET
/public/v1/organization/info`)** — a data-correctness fix (W76-2, a workflow
  review finding outside this rotation), not a security change. Previously,
  `physical_address` was published only when
  `physical_address_line1 and not physical_address_same` — so a department
  that set "physical address same as mailing" (which stores the station's
  address in the _mailing_ columns only, never populating the physical ones)
  published `physical_address: null` even though the station's address is
  public information the mailing address already carries. The fix mirrors
  `mailing_address` onto `physical_address` when `physical_address_same` is
  set, and otherwise falls back to the physical columns, unchanged. Re-checked
  against all seven dimensions as this feature's own scope requires, not
  deferred to the workflow review that authored it: the route is still gated
  by `Depends(authenticate_api_key)` (API-key auth, IP rate-limited inside
  that dependency ahead of any DB work — PP-4, unchanged), `organization_id`
  is still taken only from `api_key.organization_id` (server-resolved, never
  client-supplied — no new by-id surface), and the assembled `org_data` dict
  still passes through `filter_data_by_whitelist(...)` before
  `PublicOrganizationInfo(**filtered_data)` validates it — so a department
  that has not whitelisted `physical_address` still gets it stripped
  regardless of this fix. Both address dicts are built from `Organization`
  columns the department itself entered at onboarding (street address, city,
  state, zip) — not member or applicant PII, and already within the set an
  administrator can choose to publish. No new field was added to
  `PublicOrganizationInfo` or `org_data`; only which of two pre-existing
  fields a given configuration populates changed.

**The three webhook handlers, re-read in full against Pitfall #36
(idempotency) and the injection/auth dimensions, not assumed sound because
byte-identical to pass 11:**

- **PayPal (`paypal_webhook.py`):** rate-limited (60/min/IP) as a `Depends()`
  parameter, so it resolves before the integration lookup in the function
  body; signature verified through PayPal's own verify-webhook-signature API
  (`verify_webhook_signature`, keyed on the configured webhook id — an
  integration with none configured cannot be verified and nothing here
  trusts an unverifiable delivery); `is_duplicate_webhook` (10-minute
  freshness cache) runs after verification, never before. Below that
  freshness cache, the durable guard:
  `StorefrontService.record_external_payment` looks up
  `StorePaymentEvent` by `(organization_id, provider, external_id)` before
  inserting, **and** that tuple carries a real `UniqueConstraint`
  (`uq_store_payment_events_provider_external`,
  `app/models/storefront.py:941-946`) — so two deliveries racing past the
  SELECT still can't both insert: the loser's `db.commit()` raises
  `IntegrityError`, which the handler catches, rolls back, re-reads the
  winning row and returns it rather than erroring or double-crediting
  (`storefront_service.py:2672-2688`). This is the textbook shape Pitfall #36
  asks for — a lookup-then-insert backed by a DB constraint, not only an
  in-process check — read directly in the service rather than taken from the
  module's own docstring claim.
- **Documenso / Cal.com (`integrations_webhook.py`):** both routes rate-limit
  first (`await _rate_limit_webhook(...)` is the first line of the handler
  body, ahead of the integration lookup), then load the integration, then
  require a configured `webhook_secret` (401 if absent — never trusts an
  unsigned payload), then verify (shared-secret or HMAC for Documenso; HMAC
  only for Cal.com), then check `is_duplicate_webhook` — same ordering as
  PayPal. Idempotency beyond the 10-minute cache is structural rather than a
  constraint:
  `MembershipPipelineService.complete_current_step_for_integration_event`
  matches on the prospect's **current** step type, so a redelivery arriving
  after the first one already advanced the prospect past that step finds no
  match and returns `None` — there is no second row to double-write, because
  the condition that made the first delivery effective is no longer true.
- **Salesforce (`salesforce_webhook.py`):** webhook secret required (401 if
  absent), HMAC verified with `hmac.compare_digest` (constant-time), payload
  shape and the 500-record cap checked, and only _then_
  `is_duplicate_webhook` — deliberately after shape validation, per the
  module's own comment, so a rejected (400/422) delivery can't poison the
  replay fingerprint and cause a provider's identical retry to be silently
  dropped as "already handled". `sync_inbound_contacts` is this file's own
  previously-reviewed idempotency path (unchanged this pass).

**RFC 8414/9728 metadata endpoints (`mcp_oauth.py`'s
`authorization_server_metadata`/`protected_resource_metadata`, 6 of the 9
route decorators in that file) carry no rate limit, checked and not a
finding:** both build their response from in-memory config
(`app/mcp/oauth.py:272-300` — string formatting over settings already in
memory, no DB query, no CPU-heavy work) and set
`Cache-Control: public, max-age=300`, so there is no "expensive work" for
checklist §6 to guard ahead of; the three stateful endpoints in the same file
(`authorize`, `token`, `revoke`) still rate-limit before any DB work, as pass
8 established and this pass re-confirmed by reading `_limit`'s call sites
directly.

**Nothing to fix, nothing to flag.** The one changed file is a pre-existing
public field's data-correctness fix, still gated and whitelisted exactly as
before; the three webhook handlers are unchanged and re-verified sound,
including the durable (constraint-backed) half of idempotency this pass read
directly in the service layer rather than took from a docstring. No
`KNOWN_LIMITATIONS.md` entry needed — nothing new is flagged.

### Completion gate (pass 12)

| Check                                                                                                                                                                                                                                                                                                       | Result                                               |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| `flake8 app/ tests/ alembic/` (7.4.1)                                                                                                                                                                                                                                                                       | ✅ 0 violations                                      |
| `black --check app/ tests/ alembic/` (26.10.1, CI's pinned version — the locally-shadowing uv-tool install was at 26.5.1 and was corrected to match before running)                                                                                                                                         | ✅ 2638 files unchanged                              |
| `isort --check-only app/ tests/ alembic/` (9.0.2)                                                                                                                                                                                                                                                           | ✅ clean                                             |
| `python3 scripts/validate_migrations.py --strict`                                                                                                                                                                                                                                                           | ✅ single head `3d67883cd461`, 651 revisions         |
| `python3 scripts/check_route_permissions.py --strict`                                                                                                                                                                                                                                                       | ✅ 276 routes, 0 errors, 0 warnings                  |
| scoped pytest, unit (`-k "public or webhook or paypal or salesforce or integrations or minutes or mcp_oauth or calendar or finance_approval or branding or kiosk or badge_tap or application_self_withdraw or forms or legal or display or security_txt" -m "not integration and not slow and not docker"`) | ✅ 1488 passed, 1 skipped (`py_vapid`, pre-existing) |
| standing guard suites (org-scoping ratchet, capacity locking, CSV sweep, LIKE escaping, `create_all`-table tolerance, database-schema/`SET NULL`, baseline member grants, endpoint-auth coverage, PII-cache exclusions)                                                                                     | ✅ 208 passed                                        |
| `cd frontend && npm run typecheck`                                                                                                                                                                                                                                                                          | ✅ 0 errors                                          |
| `cd frontend && npm run lint`                                                                                                                                                                                                                                                                               | ✅ 0 errors, 0 warnings                              |

No `KNOWN_LIMITATIONS.md` change needed — nothing flagged this pass. Rotation
row 03 → ✅ (pending this PR's merge); next is Feature 04 (Storefront &
payments).

---

## Pass 11 (2026-10-22, watchdog pickup) — a new unauthenticated public-minutes surface reviewed fresh; 0 fixed, 0 new findings

Watchdog pickup: `search_pull_requests` (`is:pr is:open head:claude/security-review-`)
returned 0 results and `ListAgents` found no other reachable session, checked
fresh before starting. PR #3557 (Feature 02, Permissions & roles, pass 11) had
merged, not docs-only — only this row's clearing rides along here. Rotation row
03 was confirmed the next `⬜` by reading the table directly.

**Baseline:** `11580157` (PR #3399's merge, pass 10). **Head:** current `main`.
`git diff 11580157..HEAD --stat -- backend/app/api/public/
backend/app/core/public_portal_security.py
backend/app/services/integration_services/webhook_service.py
backend/app/utils/webhook_replay.py` touches exactly **one** file: a new
`backend/app/api/public/minutes.py` (169 L, 2 routes). Every other file in
scope — both webhook receivers' signature verification, replay fingerprinting,
`public_portal_security.py`, and the other 13 files under `app/api/public/` —
is byte-identical to pass 10. No migration touches this feature's own tables
this pass (the one table the new route reads, `minutes_public_copies`, was
created by migration `89723c04ae94`, dated 2026-10-17, before pass 10's own
baseline — Feature 24's work, not this pass's).

**The one new file, read in full against all seven checklist dimensions, plus
its collaborators (`app/utils/minutes_public.py`,
`app/services/minutes_publishing_service.py`, the `MinutesPublicCopy` model):**

- **Auth (dimension 1):** `GET /public/v1/minutes` and
  `GET /public/v1/minutes/{copy_id}` are intentionally unauthenticated — a
  department's public minutes page. Compensating control: both routes carry
  `_rate_limit_minutes` (60/min per IP) ahead of any query; `get_db` is the
  only other dependency and only yields a session, issuing no query itself,
  so this matches the established "rate limit before DB work" shape pass 7/10
  already verified for this feature's other public routes.
- **Tenant isolation (dimension 3):** single-org-deployment rule, same pattern
  as `legal.py`/`branding.py` — `_the_organization` resolves the deployment's
  one `Organization` row (`limit(2)` + exact-count-of-one check, so a second
  org makes every route 404 rather than guess) and gates on the `minutes`
  module being enabled. From there, `MinutesPublishingService.get_public` and
  `.list_public` both filter `MinutesPublicCopy.organization_id ==
organization_id` directly in the `WHERE` clause (`minutes_publishing_service.py:247`,
  `:273-274`) — `organization_id` is server-resolved, never client-supplied, so
  there is no id to forge even though the by-id lookup is also directly
  filtered (belt-and-suspenders, not relied on alone).
- **Data exposure (dimension 5):** `content` is never the minutes record —
  `narrow_for_public` (`app/utils/minutes_public.py`) builds the stored
  snapshot by **naming** each field allowed out (attendance as counts, not the
  roll; motions with text/mover/seconder/result but not individual votes or
  discussion notes; closed-session reason/authority/times but not who was in
  the room; election turnout and contest results but no voter-level detail;
  attachments and library links dropped entirely), so a field added to the
  internal printed copy later stays private until named here — the opposite
  failure mode from an denylist. Officer/signer names that do appear
  (`officers_present`, `moved_by`/`seconded_by`, `approval.signatures`) are
  deliberate, matching how departments already publish minutes with named
  officers acting in their public capacity, not personal member data. The
  response schema (`PublicMinutesDetail`/`PublicMinutesItem`) carries exactly
  this narrowed shape — no path returns the underlying `MeetingMinutes` record.
- **Injection (dimension 4):** HTML-formatted section content is re-run
  through `sanitize_html` on the way out of `narrow_for_public`
  (`_section`, `app/utils/minutes_public.py`) even though the stored value was
  already cleaned on write — "a public page is the last place to rely on
  that," per the function's own comment. All text fields are length-capped
  (`MAX_TEXT`/`MAX_SHORT`/`MAX_ITEMS`) before storage in the JSON snapshot.
- **Abuse resistance (dimension 6):** `list_public` loads the org's own
  `MinutesPublicCopy` rows (not an org-wide or cross-tenant table) and slices
  in Python after an executive-session/settings filter that isn't
  SQL-expressible in one clause; bounded in practice by one department's
  meeting cadence (not attacker-growable) and additionally capped by
  `PUBLIC_LIST_LIMIT = 200` per page regardless of the requested `limit`.
- **Schema (dimension 7):** `MinutesPublicCopy.posted_by` is
  `ForeignKey(..., ondelete="SET NULL")` and correctly `nullable=True`
  (Pitfall #2); `organization_id`/`minutes_id` are `ondelete="CASCADE"` and
  correctly `nullable=False`. No migration this pass — the table predates
  pass 10's baseline.
- **Visibility re-evaluated live, not cached from posting time, as the
  module's own docstring claims:** `_servable` (`minutes_publishing_service.py:230`)
  checks `withdrawn_at is None` and the current `public_allowed(is_executive(...))`
  setting on every call, not at posting time — confirmed by reading the method
  directly rather than trusting the docstring.

**Nothing to fix, nothing to flag.** The new surface follows every established
pattern this feature already uses for a brand-new public read route
(single-org resolution, pre-work rate limiting, org-scoped-at-the-query
lookups, defense-in-depth re-sanitization) and the response shape is built by
an explicit allowlist rather than redacting a richer record.

### Completion gate (pass 11)

| Check                                                                                                                                         | Result                                              |
| --------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| `flake8 app/ tests/ alembic/` (7.4.1)                                                                                                         | ✅ 0 violations                                     |
| `black --check app/ tests/ alembic/` (26.5.1)                                                                                                 | ✅ 2555 files unchanged                             |
| `isort --check-only app/ tests/ alembic/` (9.0.1)                                                                                             | ✅ clean                                            |
| `python3 scripts/validate_migrations.py --strict`                                                                                             | ✅ single head `e5f9bb066e07`, 639 revisions        |
| `python3 scripts/check_route_permissions.py --strict`                                                                                         | ✅ 273 routes, 0 errors, 0 warnings                 |
| scoped pytest, unit (`-k "minutes or public_portal or webhook or finance_approval" -m "not integration and not slow and not docker"`)         | ✅ 585 passed, 1 skipped (`py_vapid`, pre-existing) |
| scoped pytest, integration (`tests/test_minutes_publishing_integration.py -m integration`)                                                    | ✅ 33 passed                                        |
| standing guard suites (org-scoping ratchet, capacity locking, CSV sweep, LIKE escaping, `create_all`-table tolerance, baseline member grants) | ✅ 157 passed                                       |
| `cd frontend && npm run typecheck`                                                                                                            | ✅ 0 errors                                         |
| `cd frontend && npm run lint` (whole repo, backend + frontend)                                                                                | ✅ 0 errors, 0 warnings                             |

No `KNOWN_LIMITATIONS.md` change needed — nothing flagged this pass; PUB-8's
row is unchanged (already resolved). Rotation row 03 → ✅ (pending this PR's
merge); next is Feature 04 (Storefront & payments).

---

## Pass 10 (2026-10-18, watchdog pickup) — a new unauthenticated route reviewed fresh; 0 fixed, 0 new findings

Watchdog pickup: Step 0 confirmed via `search_pull_requests`
(`is:open head:claude/security-review-`) that no security-review PR was open,
and the dedicated `/loop 30m /security-review` session was not reachable via
`ListAgents`. PR #3398 (Feature 02, Permissions & roles, pass 10) had already
merged clean. Rotation row 03 was the next `⬜`.

**Baseline:** `1ac706d9` (PR #3215's merge, pass 9). **Head:** current `main`
(`4838c5b2`, PR #3398's merge). 605 commits (314 non-merge) in between.
`git diff 1ac706d9 HEAD --stat -- backend/app/api/public/
backend/app/core/public_portal_security.py
backend/app/services/integration_services/webhook_service.py
backend/app/utils/webhook_replay.py` touches exactly **one** file:
`backend/app/api/public/calendar.py` (+152/-20). Every other file in scope —
all three webhook receivers, `public_portal_security.py`, and the other 10
files under `app/api/public/` — is byte-identical to pass 9. No migration
touches this feature's tables this pass.

**The one changed file, read in full — a genuinely new unauthenticated
route, reviewed as such rather than diffed line-by-line:**

`calendar.py` gained a second feed, `GET /public/v1/calendar/org/{token}.ics`
— the department's published events, behind a new `ical` integration
(already shipped with its own 426-line test file,
`backend/tests/test_department_ical_feed.py`, written by the commit that
added this route — not by a security-review pass). Checked against all seven
dimensions as a fresh unauthenticated surface, not assumed safe because a
test file exists:

- **Auth (dimension 1):** token-protected, same shape as the existing
  personal feed. `_plausible_token` (extracted, unchanged logic: 32–64 chars)
  rejects implausible tokens before any DB work. The real credential is a
  `secrets.token_urlsafe(48)` token; only its SHA-256 digest
  (`hash_feed_token`, `app/services/integration_services/ical_service.py:34`)
  is stored in the integration's public `config`, compared with
  `hmac.compare_digest` — constant-time, so a mismatch's length/prefix can't
  be timed out. The plaintext lives only in the encrypted secret store
  (`row.get_secret`), confirmed redacted from the integration API response by
  `test_connecting_issues_a_stored_digest_and_secret`.
- **Lookup pattern — not a new finding:** `_integration_for_org_feed_token`
  loads every `connected`+`enabled` `ical`-type integration (across all
  orgs — there's no org to scope by until the token resolves one) and
  compares each digest in constant time, rather than matching the digest in
  a `WHERE` clause. This is the same shape `authenticate_api_key` already
  uses in `public_portal_security.py:576` (`for candidate in
result.scalars().all():`), reviewed and accepted in an earlier pass — this
  is a second instance of an existing, intentional pattern, not new surface.
  Bounded by the number of departments with the integration connected
  (organization count, not event count), so it does not grow per-request.
- **Tenant isolation (dimension 3):** once the token resolves an
  `Integration` row, every subsequent query is scoped to
  `integration.organization_id` — the event query's `where()` filters
  `Event.organization_id == organization_id` directly (`calendar.py`, the
  `get_department_events_feed` query). `test_excludes_drafts_cancelled_
out_of_window_and_other_orgs` asserts a same-named event in a second org is
  absent from the feed. Rotation and disconnect are separately asserted
  org-scoped in the integration endpoint's own tests
  (`test_rotate_is_org_scoped`: a second org's admin rotating this org's feed
  gets 404, not another org's row).
- **Data exposure (dimension 5):** `_org_feed_event` is an explicit
  allowlist — id, title, start/end, location **name** (not the full location
  record), a type label, and a URL back to the event page. Description,
  attendees/RSVPs, custom fields, attachments, cancellation reason and
  organizer are never read into the dict. `test_feed_carries_only_
allowlisted_fields` plants `SECRET-DESCRIPTION`/`SECRET-REASON`/
  `SECRET-FIELD` sentinels on the event and asserts none reach the rendered
  ICS text, plus explicit `ATTENDEE`/`ORGANIZER`/`DESCRIPTION` absence
  assertions — this is checked, not assumed.
- **Injection (dimension 4):** title/location/categories flow through the
  existing `generate_ical_feed` → `_event_to_vevent` → `_escape_ics` pipeline
  (unchanged this pass), which escapes `;`, `,`, `\` and folds all CR/LF
  variants to `\n` — the RFC 5545 ICS-injection guard already reviewed for
  the personal feed. The new `url` field is server-built
  (`f"{frontend_url}/events/{event.id}"` from `settings.FRONTEND_URL` and an
  internal id, never from event/user text) and only strips embedded
  newlines, which is sufficient since it carries no attacker-reachable
  content. `is_draft`/`is_cancelled` are filtered server-side before any
  event reaches `_org_feed_event`.
- **Abuse resistance (dimension 6):** the new route shares
  `_rate_limit_feed` with the personal feed — 60/min per IP, checked via the
  route's `dependencies=[Depends(...)]` **before** the token lookup or any
  DB query, so an attacker spraying tokens is rate-limited before the
  constant-time comparison loop runs repeatedly. The event query itself is
  bounded: a 30-day-past/365-day-future window plus `ORG_FEED_MAX_EVENTS =
2000` cap, with `selectinload(Event.location_obj)` avoiding a per-event
  query. `included_event_types` reads free-form stored JSON defensively — an
  unknown type name is dropped rather than reaching the `EventType` enum
  column, and an all-unknown list degrades to "no events" (`.in_([])`) rather
  than raising; `test_included_event_types_filters_the_feed` exercises the
  mixed known/unknown (`["training", "bogus"]`) case directly.
- **Schema (dimension 7):** no migration this pass; the integration's token
  digest and encrypted secret live in existing `Integration.config`/secret
  columns, not a new table.

**Audit trail, checked beyond this file's own diff:** `rotate_ical_feed` logs
`integration.ical_feed_rotated` with the organization id
(`test_rotate_invalidates_the_old_url_and_is_audited` asserts the
`log_audit_event` call args), and rotating or disconnecting immediately
invalidates the old token (`test_disconnect_kills_the_feed_and_reconnect_
issues_a_new_url`) — the compensating control a leaked calendar URL needs is
in place and already tested.

**Nothing to fix, nothing to flag.** The new route follows every established
pattern this feature already uses (constant-time token comparison, ICS
escaping, org-scoping-through-resolved-parent, pre-work rate limiting) and
ships with direct tests for the scenarios this review would otherwise have
had to construct by hand.

### Completion gate (pass 10)

| Check                                                                                 | Result                                                     |
| ------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `flake8 app/ tests/ alembic/` (CI's pinned version)                                   | ✅ 0 violations                                            |
| `black --check app/ tests/ alembic/` (CI's pinned version)                            | ✅ all files unchanged                                     |
| `isort --check-only app/ tests/ alembic/` (CI's pinned version)                       | ✅ clean                                                   |
| `python3 scripts/validate_migrations.py --strict`                                     | ✅ single head `1117b642643b`, 618 revisions               |
| `python3 scripts/check_route_permissions.py --strict`                                 | ✅ 270 routes, 0 errors/0 warnings                         |
| `pytest tests/ -k "calendar or ical or public_portal or webhook or finance_approval"` | ✅ 1155 passed, 1 skipped (environment-only — `pywebpush`) |
| `cd frontend && npm run typecheck`                                                    | ✅ 0 errors                                                |
| `cd frontend && npm run lint`                                                         | ✅ 0 errors, 0 warnings                                    |

No `KNOWN_LIMITATIONS.md` change needed — nothing flagged this pass. Rotation
row 03 → ✅ (pending this PR's merge); next is Feature 04 (Storefront &
payments).

---

## Pass 9 (2026-10-14, watchdog pickup) — 0 fixed, 0 new findings; PUB-8 confirmed fully landed on this path

Watchdog pickup: Step 0 confirmed via `list_pull_requests` that no
`claude/security-review-*` PR was open anywhere on the repo (the last merge,
PR #3212, Feature 02 Permissions & roles pass 9, was docs-only — nothing to
record beyond clearing the **Open PR** row). Rotation row 03 was the next
`⬜`.

**Baseline:** `b4a1f2ba` (PR #3105's merge, pass 8). **Head:** current `main`.
`git diff b4a1f2ba HEAD --stat -- backend/app/api/public/
backend/app/core/public_portal_security.py` touches 4 files; no new file
under `app/api/public/` (still the same 14 + `__init__.py` pass 8 counted).
Frontend: none — Feature 03 declares no frontend files, confirmed still true.
Migrations: none written against this feature's models this pass.

**The four changed files, read in full:**

- **`app/core/public_portal_security.py` (+72/-36)** — this is the
  unknown-key 401 half of PUB-8 landing (`log_access`/`_log_refusal` taking
  `organization_id`/`config_id`/`api_key_obj` as `Optional`, and
  `authenticate_api_key` now calling `_log_refusal(request, None, ...)` for
  the no-key and unknown-key branches). It matches, line for line, what this
  file's own **Resolved 2026-10-11** entry below already describes — that
  entry was written from the PR that landed this diff, so there is nothing
  new to re-derive. Confirmed the migration it depends on
  (`e6d21e605d99`, making both columns nullable) is present and still the
  only migration touching `public_portal_access_log`'s nullability. **PUB-8
  is fully resolved on all three fronts** (429, revoked/expired 401, unknown 401) and retained (90-day prune). No residual.
- **`app/api/public/finance_approvals.py` (+18/-1)** — new
  `acknowledge_late_substantiation` request field and `late_line_count`
  response field, unrelated to PUB-8. Traced the full path:
  `get_approval_detail` and `approve_via_token` resolve their target
  `ApprovalStepRecord` **only** by `approval_token` (`finance_service.py:3015-3027`,
  `with_for_update()`-locked, org id taken from the resolved `chain`, never
  from a client-supplied id) — the XC-3 shape this feature's by-id routes are
  held to. `late_line_count(er_id)` itself issues a bare
  `expense_report_id == er_id` count with no explicit org filter, but `er_id`
  here is always `record.entity_id` off that already-token-resolved,
  already-org-scoped record, never a client-supplied value — the "resolves
  through an already-org-scoped parent" shape the checklist's tenant-isolation
  section calls out, not the bare-id-on-an-org-carrying-model shape
  `test_org_scoping_ratchet.py` polices. `_take_late_acknowledgement` raises
  `LateSubstantiationNotAcknowledgedError` (→ 400) when the approver hasn't
  set the flag and the report has late lines, so the field cannot be used to
  silently skip the review it exists to force. No new trust boundary: the
  token is still the only credential, exactly as every other route in this
  file.
- **`app/api/public/portal.py` (+2/-2)**, **`app/api/public/responses.py`
  (+15/-12)** — a local variable rename (`result` → `org_result`, avoiding
  shadowing) and `ResponseMap = dict[int | str, dict[str, Any]]` type
  annotations on the shared `responses=` dicts. No behavior change on either;
  confirmed by reading both diffs in full rather than trusting the small line
  count.

**Nothing to fix, nothing to flag.** All four changes were already-landed
work from other tracks (finance feature work and a typing cleanup), reviewed
fresh against the checklist and found sound; PUB-8's own landing is this
feature's own prior finding completing itself, not new.

### Completion gate (pass 9)

| Check                                                  | Result                                                                                                   |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| `flake8 app/ tests/ alembic/`                          | ✅ 0 violations                                                                                          |
| `black --check app/ tests/ alembic/`                   | ✅ all files unchanged                                                                                   |
| `isort --check-only app/ tests/ alembic/`              | ✅ clean                                                                                                 |
| `python3 scripts/validate_migrations.py --strict`      | ✅ single head `252c7517d80a`, 594 revisions                                                             |
| `pytest tests/ -k "public_portal or finance_approval"` | ✅ 171 passed, 1 skipped (environment-only — `pywebpush`)                                                |
| `cd frontend && npm run typecheck`                     | ✅ 0 errors                                                                                              |
| `cd frontend && npm run lint`                          | ✅ 0 errors, 0 warnings (ran in background during this pass; the reviewed diff touches no frontend file) |

No `KNOWN_LIMITATIONS.md` change needed — PUB-8's row already reads fully
resolved from the pass-8-era PRs that landed it; this pass only confirmed the
diff on `main` matches what that row describes. Rotation row 03 → ✅ (pending
this PR's merge); next is Feature 04 (Storefront & payments).

---

## Pass 8 (2026-10-12) — a new OAuth 2.1 authorization server reviewed fresh; PUB-8's 401 half narrowed to one branch

**Watchdog pickup.** No `claude/security-review-*` PR or branch existed
anywhere in the repo (confirmed via `search_pull_requests`,
`is:open head:claude/security-review-`, 0 results), roughly 65 minutes after
PR #3097 (Feature 02, Permissions & roles, pass 8) merged with nothing
started since.

**Backend:** pass 7's closing merge (`4caded5d`, PR #2937) to current `HEAD`:
`git diff 4caded5d HEAD -- backend/app/api/public/ backend/app/core/public_portal_security.py`
touches 6 of the (now) 14 files under `app/api/public/` plus
`public_portal_security.py`. The other 8 — `branding.py`, `calendar.py`,
`display.py`, `legal.py`, `portal.py`, `responses.py`, `salesforce_webhook.py`,
`security_txt.py` — are byte-identical (confirmed by the same diff command
returning no hunks for each), so their pass 4–7 findings and "Verified good"
items stand unchanged and are not re-derived here. **Frontend:** none
modified — Feature 03 declares no frontend files. **Migrations:** none
written this pass (the one migration in this diff, `2d4304107b77`, landed
with the new file below, between pass 7 and this pass — not by this pass).

The six changed files, read in full against all seven checklist dimensions:

- **`app/api/public/mcp_oauth.py` (new file, 433 L, 8 route decorators / 7
  logical endpoints).** The MCP OAuth 2.1 authorization server's public HTTP
  surface — `/authorize`, `/token`, `/revoke`, and the RFC 8414/9728 metadata
  documents, each served at the RFC path and the `/api/`-prefixed form this
  project's reverse-proxy guidance already assumes. Every endpoint 404s
  while `MCP_OAUTH_ENABLED`/`MCP_OAUTH_ISSUER_URL` are unset
  (`_origin_or_404`), so an installation that never opted in exposes
  nothing new. All three endpoints rate-limit (60–120/min per IP,
  scope-isolated) before any form parsing or DB work. Collaborators read in
  full to verify the HTTP layer's claims against the actual decisions:
  `app/mcp/oauth.py` (1330 L — the whole authorization-server state
  machine), `app/api/v1/endpoints/mcp_oauth.py` (the CSRF-protected,
  session-authenticated consent screen and a member's own connections),
  `app/api/v1/endpoints/mcp_oauth_admin.py` (client registration/revocation,
  gated on `integrations.mcp_keys`), and `app/models/mcp_oauth.py` plus its
  migration `2d4304107b77`.
  - **Redirect URIs cannot be used as an open redirector.** Mechanism:
    `start_authorization` matches `redirect_uri` byte-for-byte against the
    client's stored list (`stored_redirect_uris`, itself read defensively —
    anything but a list of strings counts as none registered) and reports an
    unknown/mismatched URI to the browser rather than redirecting to it
    (`oauth.py:716-724`); only after that check does an error become
    eligible for `redirect=True`. `normalize_redirect_uris` additionally
    refuses a non-https scheme off loopback, a fragment, embedded
    credentials, and a wildcard at registration time.
  - **PKCE is mandatory and verified against the stored challenge, not
    merely present.** `S256` is the only method accepted
    (`code_challenge_method != "S256"` refuses), and `exchange_code`
    recomputes the challenge from the presented `code_verifier` and compares
    it to `row.code_challenge` with `hmac.compare_digest` (`oauth.py:934-937`).
  - **A code or refresh token cannot be replayed without revoking the
    connection it belongs to.** `exchange_code` locks the authorization row
    (`.with_for_update()`) and, on a second presentation of an
    already-`consumed`/`failed` code, revokes the grant that code minted
    before answering `invalid_grant` (`oauth.py:910-919`); `refresh`
    recognises a non-current refresh token for a _live_ grant the same way
    and revokes it (`oauth.py:1000-1010`). Both commit the revocation despite
    the response being an error (`CodeReplayed`/`RefreshReplayed`), so the
    attacker's and the legitimate holder's copies are both cut off.
  - **A token minted here cannot be used against this server with a
    different audience, or re-presented as another resource's.**
    `canonical_resource` requires an explicit `resource` to name this
    server's own MCP endpoint exactly (RFC 8707); `authenticate_access_token`
    re-checks `grant.resource == resource_url(base)` on every call
    (`oauth.py:1257-1259`), not only at issuance.
  - **A token is never issued, revoked, or consented-to without a traceable
    audit row.** `token()`'s handler rolls back and answers 503 if
    `log_audit_event` returns `None` (`mcp_oauth.py:383-391`), and the
    consent/registration/revocation endpoints in the two v1 files use the
    equivalent `require_audit`/`require_audit_entry` helpers — the same
    trade this codebase's service-key path (`mcp_keys.require_audit_entry`)
    already makes.
  - **What a token can do is re-derived every call, never cached from
    issuance.** `authenticate_access_token` re-reads the department's
    switches, the member's current permissions
    (`collect_user_permissions`), and the grant's own scopes on every
    request, and refuses outright if the member is no longer active or the
    department's `oauth_enabled` switch is off (`oauth.py:1271-1286`) — a
    revoked position or a disabled integration takes effect on the very
    next call, with no token to separately chase.
  - **Client secrets and token/code digests are compared in constant time.**
    `_same` (`hmac.compare_digest`) gates every secret/token comparison in
    the service (`authenticate_client`, `exchange_code`, `refresh`,
    `revoke_token`, `authenticate_access_token`); only SHA-256 digests are
    stored, which is the correct tool here precisely because what is hashed
    is always 256 bits of `secrets.token_urlsafe` output, never a
    human-chosen secret — the same reasoning the module's own docstring and
    this codebase's `nfc_tag_service.hash_tag_uid` both state.
  - **Every by-id and by-FK operation is org-scoped, including under
    `require_permission` (CLAUDE.md pitfall 14b).** `get_pending` filters
    `organization_id == str(user.organization_id)` so a request from another
    department answers the identical `LookupError` as one that does not
    exist (`oauth.py:805-813`); `revoke_grant`/`revoke_client` take
    `organization_id` as a hard filter, not merely a permission gate; a
    member revoking their own connection additionally filters `user_id`
    (`mcp_oauth.py` v1 endpoint, `revoke_my_connection`).
  - **Registered and stored bounds prevent unauthenticated storage growth
    (CLAUDE.md pitfall 9).** `MAX_PENDING_PER_CLIENT` (100, pruned first),
    `MAX_REDIRECT_URIS` (10), `MAX_CLIENTS_PER_ORG` (25),
    `MAX_GRANTS_PER_MEMBER_CLIENT` (5, oldest superseded), `MAX_STATE_CHARS`
    (1024) all cap what an unauthenticated `/authorize` caller, or an
    authenticated client, can make the server store; `_prune_authorizations`
    deletes finished rows past their retention window on every
    `/authorize` call.
  - **The model/migration pair satisfies pitfall 2 and the create_all-table
    rule.** Every `ondelete="SET NULL"` column (`grant_id`, `created_by`,
    `revoked_by`) is `nullable=True` in both the model and the migration;
    the migration guards each `create_table` on the table's own existence
    and is listed as reversible (drops cleanly; no other table references
    these three).
- **`app/core/public_portal_security.py` (+95/-18 over pass 7's baseline,
  all landed between pass 7 and this pass by other work — re-verified
  fresh, not trusted from commit messages).** Two already-shipped fixes
  confirmed sound: (1) the public-portal hourly/per-IP rate limiters moved
  from a per-process dict (ceiling = workers × limit) to a Redis `INCR`/
  `EXPIRE` fixed-window counter shared across workers
  (`_shared_window_hit`), falling back to the old per-process cache only
  when Redis is unreachable — the same degrade-not-fail policy
  `public_rate_limit` already uses elsewhere, and the fallback path itself
  is unchanged and still exercised by the existing test suite; (2)
  `_last_used_is_stale` and the two `detect_anomalies` queries now compare
  `last_used_at`/`timestamp` as `datetime` objects rather than
  `.isoformat()` strings, closing a regression where a `fromisoformat` call
  on an already-`datetime` value raised, was swallowed by a bare `except`,
  and answered "stale" (so the throttle never throttled) on every request.
  **One new fix, this pass:** see PUB-8 below — the revoked- and
  expired-key 401 branches in `authenticate_api_key` had every piece of
  information the already-fixed 429 branch has (the key is resolved before
  either 401 is raised) and simply never got the same `_log_refusal` call.
- **`app/api/public/finance_approvals.py`, `forms.py`,
  `integrations_webhook.py`, `paypal_webhook.py` — small, already-landed
  fixes, re-verified.** `_load_record` now also refuses a token whose step
  was reassigned away from an email approver
  (`step_type != APPROVAL or approver_type != EMAIL`), closing a narrow
  window where a since-repurposed token could still answer as if it
  authorized a pending approval; `forms.py` treats a `None` result the same
  as an explicit `error` string rather than returning an unhandled `None`;
  `integrations_webhook.py` gained a type annotation only; `paypal_webhook.py`
  now reads `auto_apply_payments` through the shared `paypal_auto_apply`
  helper the backfill script also uses, so the webhook and the backfill
  cannot settle a capture differently depending on which path recorded it.
  None of the four changes anything this feature's checklist review had not
  already covered; no new findings.

### Findings

**PUB-8, narrowed further — see the finding's own entry below.** One new
fix this pass: the revoked- and expired-key 401 branches in
`authenticate_api_key` now write an access-log row before raising, using the
same `_log_refusal` mechanism the 429 branch already used. Only the
"unknown key" 401 remains flagged, blocked on the nullable-column decision
described in the finding. No other new findings — the new OAuth
authorization-server surface and the four small already-landed fixes above
were all read fresh against every checklist dimension and found sound, not
spot-checked against their own docstrings.

### Guard tests added

- `tests/test_public_portal_usage_stats.py::TestRevokedAndExpiredKeysAreRecordedToo`
  (4 tests) — a revoked key's 401 and an expired key's 401 each write an
  access-log row (asserted through `status_4xx_24h`), and one test confirms
  the row survives the rollback the raise causes, mirroring
  `TestTheRefusalIsRecorded`'s coverage of the same mechanism for the 429
  branch. Reverting either new `_log_refusal` call fails its test.

### Completion gate

| Check                                                                                                                                                                                                                                                                                      | Result                                                           |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------- |
| `flake8 app/ tests/ alembic/` (7.4.1)                                                                                                                                                                                                                                                      | ✅ 0 violations                                                  |
| `black --check app/ tests/ alembic/` (26.5.1)                                                                                                                                                                                                                                              | ✅ 2179 files unchanged                                          |
| `isort --check-only app/ tests/ alembic/` (9.0.1)                                                                                                                                                                                                                                          | ✅ clean                                                         |
| `python3 scripts/validate_migrations.py --strict`                                                                                                                                                                                                                                          | ✅ single head `3c9c5025a380`, 572 revisions                     |
| `python3 scripts/check_route_permissions.py --strict`                                                                                                                                                                                                                                      | ✅ 265 routes, 0 errors, 0 warnings                              |
| `python3 scripts/check_docs_links.py`                                                                                                                                                                                                                                                      | ✅ 454 files, 0 broken links                                     |
| scoped pytest, unit (`-k "public or portal or webhook or salesforce or paypal or finance_approval or legal or display or calendar or security_txt or forms or kiosk or badge_tap or application_self_withdraw or branding or mcp_oauth" -m "not integration and not slow and not docker"`) | ✅ 837 passed, 1 skipped (`py_vapid`, pre-existing)              |
| scoped pytest, integration (same `-k`, `-m "integration"`)                                                                                                                                                                                                                                 | ✅ 211 passed, 1 skipped (pre-existing)                          |
| standing guard suites (org-scoping ratchet, capacity locking, CSV sweep, LIKE escaping, `create_all`-table tolerance, baseline member grants)                                                                                                                                              | ✅ 153 passed                                                    |
| **full backend unit suite** (`-m "not integration and not slow and not docker"`)                                                                                                                                                                                                           | ✅ 14,243 passed, 1 skipped (`py_vapid`, pre-existing), 0 failed |
| `cd frontend && npm run typecheck`                                                                                                                                                                                                                                                         | ✅ 0 errors (aliased 7.0.2 compiler)                             |
| `cd frontend && npm run lint`                                                                                                                                                                                                                                                              | ✅ 0 errors, 0 warnings                                          |

---

## Pass 7 (2026-10-05) — two new unauthenticated surfaces (branding assets, kiosk NFC badge-tap write, self-service withdrawal), 0 new findings

**Backend:** 13 files under `app/api/public/` (up from 12 — a new
`branding.py`) plus `app/core/public_portal_security.py`. Route-decorator
count: 28 (up from 20 — `branding.py`'s 3 logical endpoints each register a
`HEAD` alongside their `GET`, `display.py` gained one route, `portal.py`
gained one). Collaborators read for the new routes:
`app/services/branding_service.py`, `app/utils/app_icons.py`,
`app/services/nfc_tag_service.py` (`kiosk_check_in`, `_only_event_checked_into`,
`resolve_tag`, `check_in`, `hash_tag_uid`), `app/utils/nfc_integration.py`,
`app/schemas/nfc_tag.py`, `app/services/membership_pipeline_service.py`
(`withdraw_prospect_by_token`, `_status_token_usable`, `_can_self_withdraw`).
**Frontend:** none modified — Feature 03 declares no frontend files.
**Migrations:** none written this pass.

### Scope

Pass 6's closing merge (`aa9928dcf`, PR #2597) to current `HEAD`:
`git diff aa9928dcf HEAD -- backend/app/api/public/ backend/app/core/public_portal_security.py`
touches 5 of the (now) 13 files. The other 8 — `finance_approvals.py`,
`forms.py`, `integrations_webhook.py`, `legal.py`, `paypal_webhook.py`,
`salesforce_webhook.py`, `security_txt.py`, `responses.py`'s existing
constants — are byte-identical (confirmed by the same diff command returning
no hunks for each), so pass 4–6's findings and "Verified good" items for
those files stand unchanged and are not re-derived here.

The five changed files, read in full against all seven checklist dimensions
rather than trusted from the diff:

- **`branding.py` (new file, 216 L, 6 route decorators / 3 logical
  endpoints — app icon, iOS launch image, email masthead logo).**
  Unauthenticated by necessity (a browser/mail client fetches these with no
  session), rate-limited before any work (120/min/IP for icons+splash,
  600/min/IP for the email logo — sized for a mail provider's proxy-IP
  fan-out, per its own docstring), and reads from exactly one organization
  by design (`branding_service.get_primary_branding` — the oldest active
  org, the same rule the login page's branding endpoint already uses; this
  is a single-department-per-deployment assumption stated in the module
  docstring, not a new multi-tenant gap). `decode_logo` rejects anything
  that isn't a `data:` URI (so a logo stored as an external URL cannot turn
  an anonymous asset request into SSRF), caps the encoded size before
  allocating, and caps decoded pixel count before `Image.verify()` —
  closing the decompression-bomb angle a PNG/JPEG decoder can otherwise be
  pushed through. Render geometries are allowlisted
  (`ICON_VARIANTS`, `SPLASH_GEOMETRIES`) so a request cannot force an
  arbitrary-size render. Both in-memory caches (`_logo_cache`,
  `_asset_cache`) are bounded (a fixed 3-key dict; a 40-entry LRU with
  `popitem(last=False)` eviction) — already swept and confirmed by SEC-00
  pass 7 (class 7); re-confirmed here rather than re-derived since the file
  is this feature's own declared scope. `ETag`/`If-None-Match` and
  `X-Content-Type-Options: nosniff` are set on every response.
- **`display.py` — new `POST /{display_code}/badge-tap` (kiosk NFC card
  tap, 1 route).** The one unauthenticated **write that acts for a member**
  in this feature. Two independent switches are checked on every tap, not
  cached from the page load (`location.nfc_badge_check_in_enabled` and
  `nfc_id_cards_enabled(db, organization_id)`, the latter failing _closed_
  on a missing/unseeded integration row per its own docstring — Pitfall
  #19's reader-before-UI rule, named in its own comment). Organization and
  event resolution are display-code-first, matching the existing guest
  check-in pattern: `kiosk_check_in` derives `organization_id` from
  `location.organization_id`, never from the request, and the event is
  "whichever one is open in this room now" rather than a client-supplied
  id — removing the id-based IDOR surface a `target_event_id` parameter
  would otherwise have. The card credential itself: `tag_uid` is never
  stored or compared in the clear — `hash_tag_uid` peppers it with
  `get_encryption_salt()` before a SHA-256 lookup scoped to
  `(organization_id, uid_hash)`, so a stolen tag table from one deployment
  cannot be matched against another's, and the lookup cannot be used to
  enumerate cards cross-org. A card that fails to resolve, a revoked/lost
  card, and a member in `_BLOCKED_MEMBER_STATUSES` (inactive, suspended,
  dropped, archived) all refuse — checked directly in `resolve_tag`/
  `check_in`. The response (`KioskBadgeTapResponse`, built by
  `_kiosk_result`) deliberately strips everything the authenticated
  station's response carries except a first-name-and-initial display name —
  no member id, full name, or membership number reaches the kiosk screen,
  by construction (the dict `_kiosk_result` returns has no such keys).
  Two rate limits apply before the DB lookup: per-IP
  (`pub_badge_tap:{ip}`, 60/min + 5 min lockout — sized for a kiosk tablet
  carrying a whole room's arrivals) and, inside the handler right after
  display-code validation and before any query, per-room
  (`pub_badge_tap_room:{code}`, same ceiling) — the second closes what the
  first alone cannot: a caller spread across addresses walking card UIDs
  against one leaked display code. An audit event
  (`nfc_kiosk_badge_tap`) is logged only on an actual state change
  (checked in/out), not on a refusal, matching the authenticated station's
  own "stamp `last_used_at` only on a real tap" rule.
- **`portal.py` — new `POST /application-status/{token}/withdraw` (1
  route), plus `GET /events/public` gaining a whitelistable `id` field and
  `response_model_exclude_unset=True` (already recorded as part of PUB-7's
  2026-09-24 decision; re-confirmed unchanged at current line numbers, not
  re-litigated).** The withdrawal route shares its token contract exactly
  with the existing status read (same `Path(..., min_length=10,
max_length=64, pattern=...)`, same `validate_ip_rate_limit`, same
  no-store/no-index response headers) and both routes share one
  `_status_token_usable` gate (TTL + `public_status_enabled_for`) so they
  cannot disagree about which tokens are live — the same anti-drift
  reasoning PUB-9's `response_model_exclude_unset` fix relied on for the
  read side. The write itself: `withdraw_prospect_by_token` takes
  `.with_for_update()` on the prospect row (closing the same
  read-then-write race Pitfall #27 names), re-checks status against a
  narrow allowlist (`ACTIVE`, `ON_HOLD` only — anything else, including an
  already-withdrawn or already-approved application, answers 409 rather
  than silently no-op'ing), and the `reason` free-text field is
  `html.escape`d before being interpolated into the coordinator-notification
  email body (`_notify_coordinators_of_withdrawal`, confirmed at the actual
  call site) — satisfying checklist §4's "user text in email HTML is
  escaped" item for the one new attacker-influenceable string this route
  introduces. No amount, financial data, or other prospect PII is
  returned — the response is `{status, message}` only.
- **`calendar.py`** — one unrelated line, `date.today()` → `org_today(org)`
  (a correctness fix: the calendar feed's "today" now follows the
  organization's configured timezone rather than the server's wall clock,
  consistent with CLAUDE.md's UTC-storage/local-display rule). No security
  effect; the feed still exposes only the token's own user's shifts.
- **`public_portal_security.py`** — the `_log_refusal` addition this file's
  own pass-6 section already documented in full (PUB-8's "429 half is now
  recorded", dated 2026-09-24/PR #2665, landed between pass 6 and this
  pass). Re-read at current line numbers rather than trusted from the
  prior write-up: unchanged in substance — commits (not flushes) a
  best-effort access-log row before the 429 raise, using `organization_id`/
  `config_id` already resolved by that point, with a failed write rolled
  back rather than replacing the 429.

Also checked and ruled out of scope: `app/core/security_middleware.py`'s
`IPLoggingMiddleware` gained an `is_unlogged_path` carve-out for
`/api/v1/suggestions/(boxes/.../submissions|follow-up/...)`. Read directly —
both route families require `get_current_user` (session-authenticated;
"anonymous" there means anonymous _to other members of the department_, not
to the server), live under `app/api/v1/endpoints/`, and are not part of this
feature's declared `api/public/*` scope. Not a public/webhook surface and not
reviewed further here.

### Route inventory — delta from pass 4's full inventory

Pass 4's inventory (20 routes, reproduced in that section below) is still
accurate for every route it lists. New routes this pass:

| Method   | Path                                                 | Compensating control                                                                                             | Org resolved from                     |
| -------- | ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| GET/HEAD | `/api/public/v1/branding/icon/{variant}.png`         | 120/min per IP; variant allowlist (`ICON_VARIANTS`)                                                              | the deployment's one org (fixed rule) |
| GET/HEAD | `/api/public/v1/branding/splash/{geometry}.png`      | 120/min per IP; geometry allowlist (`SPLASH_GEOMETRIES`)                                                         | same                                  |
| GET/HEAD | `/api/public/v1/branding/email-logo`                 | 600/min per IP; `v` digest must match current logo (else 404)                                                    | same                                  |
| POST     | `/api/public/v1/display/{display_code}/badge-tap`    | 40-bit display code + per-IP 60/min+5min-lockout + per-room 60/min+5min-lockout + two org-level feature switches | the display code's location row       |
| POST     | `/api/public/v1/application-status/{token}/withdraw` | 256-bit token, 100/min per IP, `with_for_update()`, status allowlist (409 otherwise)                             | the token's prospect row              |

### Verified good ✅ (pass 7 additions)

- **The kiosk badge-tap write cannot be used to enumerate members or
  cross-org card data.** Mechanism: `hash_tag_uid` peppers every UID with
  the installation's encryption salt before lookup, and every lookup is
  scoped to `(organization_id, uid_hash)` — derived from the display code,
  never the request — so a correct card UID for org A cannot resolve
  against org B, and an incorrect one is indistinguishable from a correct
  one belonging to someone else (`resolve_tag` returns the same
  `UNKNOWN_CARD` either way).
- **The kiosk response schema structurally cannot carry a member id, full
  name or membership number.** Mechanism: `_kiosk_result` builds the
  returned dict explicitly, field by field, from a allow-list of keys —
  there is no code path that copies the fuller internal result (which does
  carry `user_id`/`member_name`/`membership_number` for the audit log) into
  the response.
- **The branding routes cannot be used for SSRF or a decompression bomb.**
  Mechanism: `decode_logo` only reads `data:` URIs (an external-URL logo
  value is treated as undecodable, never fetched) and rejects on encoded
  size before allocating and on pixel count before `Image.verify()` is even
  called — both checks run before any decompression work.
- **The self-withdrawal write and the existing status read cannot disagree
  about which tokens are live.** Mechanism: both call the same
  `_status_token_usable` (TTL + `public_status_enabled_for`), so a token the
  read answers 404 for cannot be used to withdraw, and vice versa.
- **All five routes/route-families this pass added are rate-limited before
  any database work**, matching checklist §6 — confirmed by reading each
  dependency/call ordering directly (see per-file notes above).

### Findings

**None new.** Two genuinely new unauthenticated surfaces this pass (branded
app-icon/splash/email-logo assets, and the kiosk NFC badge-tap write) plus one
new unauthenticated write on an existing token (self-service application
withdrawal) were read in full against all seven checklist dimensions, not
spot-checked against their own docstrings. Every one resolves its
organization from a credential the request cannot forge (the display code,
the status token, or the deployment's fixed single-org rule), is rate-limited
ahead of its database/CPU work, and — for the two writes — locks or
re-validates state before mutating it. The one open item this feature
carries forward, PUB-8's 401-logging half, is unchanged (re-confirmed against
`docs/KNOWN_LIMITATIONS.md`, still correctly flagged, still blocked on the
same nullable-column migration decision). No new `KNOWN_LIMITATIONS.md`
entry — nothing new in this pass needs one.

### Schema & migration notes

No migration written this pass; no model changed. `KioskBadgeTapRequest`/
`Response` and the two withdrawal-route Pydantic models are request/response
schemas only, not tables.

### Guard tests

No new guard tests added — both new routes already carry dedicated test
coverage from the feature work that introduced them
(`tests/test_kiosk_badge_tap.py`, including `TestResponseSchema::
test_the_public_response_has_no_identifying_fields`;
`tests/test_application_self_withdraw.py`), re-run as part of the scoped and
full suites below. The standing guard suites this feature depends on
(org-scoping ratchet, capacity locking, endpoint-auth coverage, CSV sweep,
LIKE escaping, PII-cache exclusions, `create_all`-table tolerance, baseline
member grants, `SET NULL` nullability) all re-run clean.

### Completion gate

| Check                                                                                                                                                                                                                  | Result                                              |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| `flake8 app/ tests/ alembic/` (7.4.1)                                                                                                                                                                                  | ✅ 0 violations                                     |
| `black --check app/ tests/ alembic/` (26.5.1)                                                                                                                                                                          | ✅ 1874 files unchanged                             |
| `isort --check-only app/ tests/ alembic/` (9.0.1)                                                                                                                                                                      | ✅ clean                                            |
| `python3 scripts/validate_migrations.py --strict`                                                                                                                                                                      | ✅ single head `34d3d56d1479`, 512 revisions        |
| `python3 scripts/check_route_permissions.py --strict`                                                                                                                                                                  | ✅ 244 routes, 0 errors, 0 warnings                 |
| `python3 scripts/check_docs_links.py`                                                                                                                                                                                  | ✅ 431 files, 0 broken links                        |
| scoped pytest (`-k "public or portal or webhook or salesforce or paypal or finance_approval or legal or display or calendar or security_txt or forms or kiosk or badge_tap or application_self_withdraw or branding"`) | ✅ 871 passed, 1 skipped (`py_vapid`, pre-existing) |
| standing guard suites (org-scoping ratchet, capacity locking, endpoint-auth coverage, CSV sweep, LIKE escaping, PII-cache exclusions, `create_all`-table tolerance, baseline member grants, `SET NULL` nullability)    | ✅ 184 passed                                       |
| **full backend unit suite** (`-m "not integration and not slow and not docker"`)                                                                                                                                       | ✅ 12 600 passed, 1 skipped, 0 failed               |
| `cd frontend && npm run typecheck`                                                                                                                                                                                     | ✅ 0 errors (aliased 7.0.2 compiler)                |
| `cd frontend && npm run lint`                                                                                                                                                                                          | ✅ 0 errors, 0 warnings                             |

No source file changed this pass — every check above is a re-verification of
newly-landed feature work, not a fix, so there is nothing for a
behavior-neutrality diff against unmodified `HEAD` to compare.

---

## Pass 6 (2026-09-15) — re-verified, no new findings

**Backend:** all 12 files under `app/api/public/` (2 482 L, 20 routes) plus
`app/core/public_portal_security.py` (556 L) — **read in full, not diffed**,
continuing pass 4/5's methodology — plus the collaborators prior passes
named: `app/schemas/public_portal.py`, `app/utils/webhook_replay.py`,
`app/services/integration_services/webhook_service.py`'s two verifiers,
`paypal_service.verify_webhook_signature`, `finance_service.approve_by_token`
/ `deny_by_token`, `forms_service.submit_public_form` /
`_create_public_submission` / `_sanitize_submission_data`,
`membership_pipeline_service.get_prospect_by_token`,
`scheduling_service.get_user_by_calendar_token` / `get_shifts_for_user_feed`,
`security_middleware.public_rate_limit` / `daily_cap_exceeded`,
`core/database.get_session`
**Frontend:** none modified — Feature 03 declares no frontend files
**Migrations:** none written

### Scope

`git log 2a4ea671a..origin/main -- backend/app/api/public/ backend/app/core/public_portal_security.py`
(`2a4ea671a` is pass 5's own closing merge commit, PR #2540) returns **zero**
commits, and `git diff 2a4ea671a origin/main` across the full 13-file set
returns no lines — every one of the 12 `api/public/` files plus
`public_portal_security.py` is byte-identical to pass 5's reviewed state.
File count unchanged at 12; route count re-derived and unchanged at 20
(`grep -rc "@router\." backend/app/api/public/*.py` sums to 20).

**One collaborator file changed, read against its full commit rather than
trusted on its own description:** `backend/app/api/public/finance_approvals.py`
(a declared Feature 03 file, since the token-authenticated finance-approval
routes live there) gained 25 lines in commit `6613919e2` — Feature 05's own
pass 5 work (PR #2544), which added `log_audit_event` calls to
`approve_via_token` and `deny_via_token` recording
`finance.approval_step_approved` / `finance.approval_step_denied`. Checked
independently rather than deferred to Feature 05's own write-up, since the
file is in this feature's declared scope:

- **No PII/PHI in the event payload** — `event_data` carries only
  `step_record_id` (an internal UUID, already opaque to the caller),
  `entity_type.value`, and the literal string `"email_token"`
  (`finance_approvals.py:153-157`, `:198-202`).
- **Org resolution is not payload-derived** — `organization_id` is
  `record.chain.organization_id` (`:158`, `:203`), and `record.chain` is
  eager-loaded via `contains_eager(ApprovalStepRecord.chain)` inside
  `FinanceService.approve_by_token`/`deny_by_token`
  (`finance_service.py:956`, and the equivalent `.options()` in
  `deny_by_token`), so this is not a lazy-load-outside-greenlet risk and not
  a value the anonymous caller controls.
- **A failure in the audit write cannot roll back or corrupt the approval.**
  `log_audit_event` → `AuditLogger.create_log_entry` wraps its insert in
  `async with db.begin_nested()` (`app/core/audit.py:190`), a SAVEPOINT
  isolating an audit-logging failure from the caller's transaction — the
  same pattern already relied on elsewhere in this codebase, not a new one
  introduced here.
- **Ordering is safe against PUB-10's class of bug.** The audit call sits
  between the service call and `db.commit()`, and both success responses
  (`ApprovalActionResponse`) are static-shape models built from
  `record.status.value` and a fixed string — nothing here can fail
  response-model validation after commit the way `/events/public` (PUB-7)
  can, so this addition does not reopen PUB-10's ordering hazard on a
  different route.

No finding. This is Feature 05's territory and already reviewed there
(`docs/security-review/FIN-05-finance-approvals.md`); recorded here because
the file itself is declared in this feature's scope and pass 6's convention
is to read every in-scope diff directly rather than trust another feature's
write-up for a shared file.

Also re-checked the collaborator set for drift, since PUB-03 depends on
functions defined elsewhere: `git log 2a4ea671a..origin/main --
backend/app/services/membership_pipeline_service.py` shows one commit
(`bcbeb9c72`, Feature 08's MP-30 fix, closing the election-vote gate's
transfer-path bypass) — confirmed it does not touch
`get_prospect_by_token` (still at line 5864, well outside the diff's
1811-3198 hunk range), the only function this feature's
`GET /application-status/{token}` route calls into that file for. No other
declared collaborator file changed since `2a4ea671a`.

### Re-verified still current

All "Verified good" items from pass 4/5 re-checked at current line numbers
and still hold: all four webhook receivers verify (HMAC or PayPal's own API)
before acting and fail closed when unconfigured; none trusts the payload for
tenancy; replay fingerprinting is still ordered after verification at all
four, and after payload-shape validation at Salesforce (PUB-1 round 2); the
finance token path still holds `with_for_update()`, the `PENDING` re-check,
expiry, and PUB-4's self-approval guard (`finance_service.py:964-992`),
token cleared before flush; `display.py`'s guest check-in still resolves
org/location from the display code and both rejection gates still precede
the daily-cap `INCR`; zero `csv.writer` and zero `like`/`ilike` in the 13
files; no public response is reachable by the frontend response cache;
`public_portal_security.py`'s two in-memory caches are still bounded with
eviction (Pitfall #9); `PublicPortalAccessLog.organization_id`/`config_id`
are still `nullable=False` (PUB-8's flagged half is unchanged); `PublicEvent`
still requires `id`/`event_type`/`start_time`/`location`/`is_public` while
the handler at `portal.py:500-511` still doesn't produce them (PUB-7 is
unchanged, still correctly flagged); PUB-5/5b/6/9/10's fixes are all in place
unchanged.

**Line-number correction (documentation only, not a code change):**
`docs/KNOWN_LIMITATIONS.md`'s PUB-7 and PUB-8 rows cited `portal.py:482-493`,
`public_portal.py:269-279`, `public_portal_security.py:322-334` and
`public_portal.py:202-211` — accurate as of pass 4 (2026-09-08), but the file
grew between pass 4 and pass 5 (539 L → 556 L for
`public_portal_security.py`, per both passes' own headers) without the
citations being refreshed, and neither file has changed since. Corrected to
the current, verified line numbers: `portal.py:500-511`,
`public_portal.py:280-290`, `public_portal_security.py:337-347`, and
`public_portal.py:202-210`. No change in substance — both findings' status,
mechanism and disposition are exactly as pass 4/5 recorded them.

### Findings

**None new.** No route was added or removed (still 20); the one in-scope
file change is a correctness/observability addition from a different
feature's own pass, independently re-verified above and found to introduce
no PII exposure, no tenancy risk, and no PUB-10-class ordering hazard; every
security-relevant control this feature owns — signature verification,
replay ordering, tenancy resolution, rate limiting, the two flagged items —
is byte-identical to pass 5's fixed/flagged state.

### Guard tests

No new guard tests — no application code change in this feature's scope.
Pass 4/5's suites (`TestCheckRateLimitDbReconciliation`,
`test_public_portal_whitelist_shape.py`,
`test_public_portal_access_log_persistence.py`,
`TestApproveByTokenSelfApprovalGuard`) re-run as part of the scoped and full
suites below; all still pass.

### Completion gate

| Check                                                                       | Result                                              |
| --------------------------------------------------------------------------- | --------------------------------------------------- |
| `flake8 app/ tests/ alembic/` (7.3.0, flake8-pytest-style 2.2.0)            | ✅ 0 violations                                     |
| `black --check app/ tests/ alembic/` (26.5.1)                               | ✅ 1 596 files unchanged                            |
| `isort --check-only app/ tests/ alembic/` (9.0.1)                           | ✅ clean                                            |
| `validate_migrations.py --strict`                                           | ✅ single head `6ab7d903fae5`, 444 revisions        |
| `check_route_permissions.py --strict`                                       | ✅ 228 routes, 0 errors, 0 warnings                 |
| `check_docs_links.py`                                                       | ✅ 358 files, 0 broken links                        |
| scoped pytest (`-k "public or portal or webhook or salesforce or ..."`)     | ✅ 588 passed, 1 skipped (`py_vapid`, pre-existing) |
| ratchet + public-portal + finance-token suites                              | ✅ 112 passed                                       |
| **full backend suite** (`-m "not integration and not slow and not docker"`) | ✅ 10 199 passed, 1 skipped, 0 failed               |
| `tsc --noEmit`                                                              | ✅ 0 errors (no frontend file modified)             |
| `eslint .` (`--max-warnings 10`)                                            | ✅ 0 errors, 0 warnings                             |

---

## Pass 5 (2026-09-14) — re-verified, no new findings

**Backend:** all 12 files under `app/api/public/` (2 482 L, 20 routes) plus
`app/core/public_portal_security.py` (556 L) — **read in full, not diffed**,
continuing pass 4's methodology — plus the collaborators pass 4 named:
`app/schemas/public_portal.py`, `app/utils/webhook_replay.py`,
`app/services/integration_services/webhook_service.py`'s two verifiers,
`paypal_service.verify_webhook_signature`, `finance_service.approve_by_token`,
`forms_service.submit_public_form` / `_create_public_submission` /
`_sanitize_submission_data`, `membership_pipeline_service.get_prospect_by_token`,
`scheduling_service.get_user_by_calendar_token` / `get_shifts_for_user_feed`,
`security_middleware.public_rate_limit` / `daily_cap_exceeded`,
`core/database.get_session`
**Frontend:** none modified
**Migrations:** none written

### Scope

`git log d03530fc..origin/main -- backend/app/api/public/ backend/app/core/public_portal_security.py`
(`d03530fc` is pass 4's own closing merge commit) returns **one** commit,
`93364039` — feature 27's membership-pipeline meeting-stage-advance fix,
touching only `integrations_webhook.py` (+18/-6). File count unchanged at 12;
route count re-derived and unchanged at 20 (`grep -rc "@router\."` across all
12 files sums to 20).

**The one in-scope change, read against its full commit rather than trusted
on its own description:** `documenso_inbound_webhook` and
`calcom_inbound_webhook` used to pass `completed_by="integration:documenso"` /
`"integration:calcom"` — a descriptive sentinel into a column that is a FK to
`users.id`, so the advance silently died on the constraint. Both now pass
`completed_by=None`, with the acting integration recorded in `action_result`
and the audit event instead (unchanged). Separately, `calcom_inbound_webhook`
now gates on `event["attended"]` instead of `event["created"]` — Cal.com's
`MEETING_ENDED` trigger rather than `BOOKING_CREATED`, so picking a future
slot no longer advances a stage whose own checkbox says "attendance". Neither
change touches signature verification, replay ordering, or org resolution,
which sit above this code and are unchanged (`_load_integration` still filters
`(id, integration_type, enabled)`; `_require_webhook_secret` still fails
closed; both signature checks still run, and `is_duplicate_webhook` still
runs after them, before this line). Traced the ripple into
`guest_check_in_service.py` (outside this feature's 13-file scope, but the
service `display.py`'s public guest-check-in route calls): its own copy of
the meeting-matching predicate was replaced by a call to a new shared
`membership_pipeline_service.meeting_config_matches_event`, whose docstring
claims a behavior change (a stage naming neither event type nor id now
matches nothing, rather than matching any attendance) — verified against the
function body (`return False` at the fall-through, not `True`), so the shared
helper is a tightening, not a new gap; the change is a correctness fix
belonging to features 15/27, not a regression this feature introduces.

Also diffed the wider collaborator set pass 4 named, since several changed
substantially since pass 4 for reasons unrelated to this feature
(`forms_service.py` +294/-, `membership_pipeline_service.py` +762/-,
`scheduling_service.py` +517/-, mostly the same membership-pipeline commit
plus unrelated scheduling work). Checked specifically whether the four
functions this feature's public routes actually call
(`submit_public_form`, `_sanitize_submission_data`, `get_prospect_by_token`,
`get_user_by_calendar_token`, `get_shifts_for_user_feed`) were touched: none
were (`git log d03530fc..origin/main -- <file> | grep "def <name>"` returns
nothing for each). `_create_public_submission`'s call into
`_process_integrations` gained an `is_public=submitted_by is None` argument —
Events-request-pipeline territory (feature 19), not this feature's, and
narrows an existing gate rather than widening public reach. `webhook_service.py`,
`paypal_service.py` and `webhook_replay.py` — the actual signature-verification
and replay code all four webhooks depend on — are byte-identical to pass 4.
`security_middleware.py` gained two more CSV-export paths to its unrelated
export-endpoint list (+2 lines, nothing this feature reaches); `database.py`
gained a `"refresh"` event listener alongside the existing `"load"` one so a
`populate_existing=True` re-read also gets its naive datetimes stamped UTC — a
strictly wider application of the invariant PUB-03's "checked and deliberately
not raised" section already relied on, not a narrower one;
`finance_service.py`'s only change is an unrelated `float` → `Decimal`
pass-through in the authenticated pending-approvals list, not the token path.

### Re-verified still current

All ten "Verified good" items from pass 4 re-checked at current line numbers
and still hold: all four webhook receivers verify (HMAC or PayPal's own API)
before acting and fail closed when unconfigured; none trusts the payload for
tenancy, all four resolving `organization_id` from the integration row;
replay fingerprinting is still ordered after verification at all four, and
after payload-shape validation at Salesforce (PUB-1 round 2); the finance
token path still holds `with_for_update()`, the `PENDING` re-check, expiry,
and PUB-4's self-approval guard, token cleared before flush;
`display.py`'s guest check-in still resolves org/location from the display
code and both rejection gates still precede the daily-cap `INCR`; zero
`csv.writer` and zero `like`/`ilike` in the 13 files; no public response is
reachable by the frontend response cache (all seven call sites still use bare
`axios`/`fetch`/`createApiClient()`, re-checked); `public_portal_security.py`'s
two in-memory caches are still bounded with eviction (Pitfall #9);
`PublicPortalAccessLog.organization_id`/`config_id` are still `nullable=False`
(PUB-8's flagged half is unchanged, still correctly mirrored in
`KNOWN_LIMITATIONS.md`); `PublicEvent` still requires `id`/`event_type`/
`start_time`/`location`/`is_public` while the handler still doesn't produce
them under a non-empty whitelist (PUB-7 is unchanged, still correctly
flagged and mirrored). PUB-5/5b/6/9/10's fixes are all in place unchanged in
`portal.py` and `public_portal_security.py` — `max(current_count, db_count)`
scoped to the fixed hour bucket, every field on both organization models
defaulting to `None`, both organization routes carrying
`response_model_exclude_unset=True`, and all three success paths
constructing (and thereby validating) the response object before calling
`log_public_api_request`.

Also re-ran the "checked and deliberately not raised" list's premises rather
than re-deriving them from scratch: `core/database.py`'s UTC-stamping
listener (now firing on `"refresh"` too, see above) still closes the naive/
aware `token_expires_at` comparison in `finance_service.py`; the legacy-prefix
bcrypt fan-out and `PublicFormResponse.id` items are unchanged code, so the
prior conclusions stand; `get_user_by_calendar_token` still doesn't filter
`is_active` (confirmed untouched, see Scope above); the Salesforce route's
`payload.get(...)` on a signed-but-possibly-non-dict body is unchanged.

### Findings

**None new.** No route was added or removed (still 20); the one in-scope
commit is a correctness fix from a different feature that, if anything,
tightens an adjacent gate rather than loosening one, and every
security-relevant control this feature owns — signature verification, replay
ordering, tenancy resolution, rate limiting, the two flagged items — is
byte-identical to pass 4's fixed/flagged state.

### Guard tests

No new guard tests — no code change in scope. Pass 4's suites
(`TestCheckRateLimitDbReconciliation`, `test_public_portal_whitelist_shape.py`,
`test_public_portal_access_log_persistence.py`) re-run as part of the scoped
and full suites below; all still pass, confirming their fixes have not
regressed.

### Completion gate

| Check                                                                   | Result                                              |
| ----------------------------------------------------------------------- | --------------------------------------------------- |
| `flake8 app/ tests/ alembic/` (7.3.0, flake8-pytest-style 2.2.0)        | ✅ 0 violations                                     |
| `black --check app/ tests/ alembic/` (26.5.1)                           | ✅ 1 592 files unchanged                            |
| `isort --check-only app/ tests/ alembic/` (9.0.1)                       | ✅ clean                                            |
| `validate_migrations.py --strict`                                       | ✅ single head `6ab7d903fae5`, 444 revisions        |
| `check_route_permissions.py --strict`                                   | ✅ 228 routes, 0 errors                             |
| `check_docs_links.py`                                                   | ✅ 358 files, 0 broken links                        |
| scoped pytest (`-k "public or portal or webhook or salesforce or ..."`) | ✅ 547 passed, 1 skipped (`py_vapid`, pre-existing) |
| ratchet suites (org-scoping, endpoint-auth, LIKE, CSV, capacity)        | ✅ 59 passed                                        |
| **full backend suite**                                                  | ✅ 10 158 passed, 1 skipped, 0 failed               |
| `tsc --noEmit` / `eslint .`                                             | n/a — no frontend file modified                     |

---

## Pass 4 (2026-09-08)

**Backend:** all 12 files under `app/api/public/` (2 351 L, 20 routes) plus
`app/core/public_portal_security.py` (539 L) — **read in full, not diffed** —
and the collaborators the public routes actually reach:
`app/schemas/public_portal.py`, `app/utils/webhook_replay.py`,
`app/services/integration_services/webhook_service.py`'s two verifiers,
`paypal_service.verify_webhook_signature`, `finance_service.approve_by_token`,
`forms_service.submit_public_form` / `_create_public_submission` /
`_sanitize_submission_data`, `membership_pipeline_service.get_prospect_by_token`,
`scheduling_service.get_user_by_calendar_token` / `get_shifts_for_user_feed`,
`security_middleware.public_rate_limit` / `daily_cap_exceeded`,
`core/database.get_session`
**Frontend:** none modified; `modules/prospective-members/services/api.ts`,
`services/formsServices.ts` and the three `fetch()` call sites read to settle
the response-cache question below
**Migrations:** none written

### Scope — full read, not a diff

`git log 9f7e3f314..main -- backend/app/api/public/ backend/app/core/public_portal_security.py`
(pass 3's own closing commit as the lower bound, with the corrected file set
pass 3 established) returns **two** commits, `0b5dae82d` and `eb78bc285`, both
feature 27's Integrations work on the webhook transports and the Salesforce
rate-limit docstring — neither introduces a public route.

So a diff-scoped pass would have had nothing to look at, and passes 2 and 3
were both diff-scoped. This pass therefore read all 13 files end to end, the
same methodology change PERM-02's pass 4 made for the same reason, and **that
is what produced all three findings** — every one predates pass 3 and none is
visible in any diff since pass 1. Route count re-derived and unchanged at 20;
file count unchanged at 12.

### Route inventory — all 20 unauthenticated routes

Dimension 1 is "no" for every route here by construction, so it is worked as:
what is the **compensating control**, and does the route resolve its
organization from that control rather than from the request?

| Method | Path                                                       | Compensating control                                                                 | Org resolved from             |
| ------ | ---------------------------------------------------------- | ------------------------------------------------------------------------------------ | ----------------------------- |
| GET    | `/api/public/v1/organization/info`                         | API key (bcrypt, selective prefix) → IP 100/min → key n/hour → `public_info` module  | the key's own row             |
| GET    | `/api/public/v1/organization/stats`                        | same                                                                                 | the key's own row             |
| GET    | `/api/public/v1/events/public`                             | same, plus `limit` capped at 100                                                     | the key's own row             |
| GET    | `/api/public/v1/application-status/{token}`                | 256-bit token, 100/min per IP, pipeline opt-in, sliding TTL, `no-store` headers      | the prospect row              |
| GET    | `/api/public/v1/health`                                    | none needed — static strings, no request input read                                  | n/a                           |
| GET    | `/api/public/v1/display/{code}`                            | 40-bit display code, ASCII `fullmatch`, 60/min per IP                                | the location row              |
| GET    | `/api/public/v1/display/{code}/events/{id}/guest`          | same, plus event must be in that room; uniform 404 on every failure                  | the location row              |
| POST   | `/api/public/v1/display/{code}/events/{id}/guest-check-in` | 10/min + 10-min lockout, honeypot, per-event daily cap, bounded payload              | the location row              |
| GET    | `/api/public/v1/calendar/{token}.ics`                      | 384-bit feed token, 60/min per IP, `deleted_at IS NULL`                              | the token's user              |
| GET    | `/api/public/v1/forms/{slug}`                              | 48-bit hex slug (regex), 60/min + 5-min lockout, published+public only               | the form row                  |
| POST   | `/api/public/v1/forms/{slug}/submit`                       | 10/min + 10-min lockout, CAPTCHA, honeypot, per-slug daily cap, sanitizer            | the form row                  |
| GET    | `/api/public/v1/legal`                                     | 30/min per IP, `limit(2)` single-org guard, 100 kB cap, plain text only              | n/a — anonymous               |
| GET    | `/.well-known/security.txt`                                | none needed — rendered from settings, no request input read                          | n/a                           |
| POST   | `/api/public/v1/webhooks/salesforce/{integration_id}`      | HMAC-SHA256 (fail closed if unconfigured), 30/min, 500-record cap, replay guard      | `integration.organization_id` |
| POST   | `/api/public/v1/webhooks/paypal/{integration_id}`          | PayPal `verify-webhook-signature` (fail closed), 60/min, replay guard                | `integration.organization_id` |
| POST   | `/api/public/v1/webhooks/documenso/{integration_id}`       | shared secret **or** HMAC (fail closed), 30/min, replay guard                        | `integration.organization_id` |
| POST   | `/api/public/v1/webhooks/calcom/{integration_id}`          | HMAC-SHA256 (fail closed), 30/min, replay guard                                      | `integration.organization_id` |
| GET    | `/api/public/v1/finance/approvals/{token}`                 | 256-bit token, 30/min per IP; returns step name/status only, no amount               | the record's chain            |
| POST   | `/api/public/v1/finance/approvals/{token}/approve`         | same + `with_for_update()` + PENDING re-check + expiry + self-approval guard         | the record's chain            |
| POST   | `/api/public/v1/finance/approvals/{token}/deny`            | same (no self-approval guard, deliberately — withdrawing your own is not a conflict) | the record's chain            |

### Verified good ✅

- **All four webhook receivers verify before they act, and fail closed when
  unconfigured.** Mechanism, per receiver: Salesforce and Cal.com compare an
  HMAC-SHA256 over the **raw body** with `hmac.compare_digest`; Documenso
  accepts either that or a `compare_digest` on the shared secret; PayPal asks
  PayPal's own `verify-webhook-signature` API and treats anything that is not
  an explicit `SUCCESS` — a missing header, an unconfigured `webhook_id`, a
  transport failure, a ≥400 — as "do not trust this". Each returns/raises
  **before** any service call, so no forged payload reaches
  `sync_inbound_contacts`, `record_external_payment` or
  `complete_current_step_for_integration_event`.
- **No webhook trusts the payload for tenancy.** Mechanism: all four resolve
  the organization from `integration.organization_id` on a row selected by
  `(id, integration_type, enabled)`; the payload's own fields are never read
  for an org, and the integration type is part of the `WHERE`, so a Cal.com id
  cannot be presented to the Documenso route.
- **Replay protection is ordered correctly at all four**, in two different
  correct ways: PayPal, Documenso and Cal.com fingerprint **after** signature
  verification (an unsigned request must not be able to poison a fingerprint);
  Salesforce additionally defers it past payload-shape validation, which is
  PUB-1 round 2's fix and is still in place at `salesforce_webhook.py:173`.
- **The finance token path still holds every guard passes 1–2 established.**
  Mechanism, re-read at current line numbers: `finance_service.py:951-999` —
  `with_for_update()` on the record joined to its chain, `status != PENDING`
  rejected, expiry checked, `_ensure_current_step`, the `EMAIL`-approver
  self-approval comparison (PUB-4), and `approval_token = None` before the
  flush, so the token is single-use.
- **`display.py`'s guest check-in still resolves org and event from the
  display code**, and both rejection gates still precede the atomic daily-cap
  `INCR` (`display.py:335-361`) — the ordering `b2b2c53c` established and pass
  3 recorded.
- **No CSV writer and no `like`/`ilike` anywhere in the 13 files** (checklist
  §4, Pitfalls #15 and #25): grep returns zero hits in `app/api/public/` and
  `public_portal_security.py`. The one LIKE that reads this feature's data is
  the admin-side access-log filter, and it already carries `like_pattern` +
  `escape=LIKE_ESCAPE_CHAR` (`public_portal_admin.py:398-402`).
- **No public response is reachable by the frontend response cache.**
  Mechanism: `utils/apiCache.ts` is imported only by `services/apiClient.ts`
  (SEC-00 pass 4's finding, re-derived here), and every frontend caller of an
  `/api/public/v1/...` path uses bare `axios`, bare `fetch`, or a
  `createApiClient()` instance — checked at all seven call sites, including
  `application-status`, which is the only one returning a person's name.

### Findings

Three, all reachable without credentials or with only a valid API key, all
older than pass 3.

#### PUB-5 — MED — The per-API-key hourly quota could be held below its ceiling indefinitely — ✅ FIXED

**What:** `check_rate_limit` keeps a per-process in-memory tally and, once that
tally reaches 90 % of the key's limit, replaces it with a `COUNT(*)` over
`public_portal_access_log` — **assigning** the database's answer rather than
reconciling with it.

**Where:** `app/core/public_portal_security.py:157-172` (pre-fix; the fix is
at `:157-182` now).

**Failure scenario:** that table only ever carried requests that _committed_.
`get_db` rolls the session back whenever the handler raises (asserted, not
assumed — see the guard test), and every non-200 answer on this router is an
`HTTPException`; a 401 or 429 never reaches the handler that writes the row at
all. So for a caller whose requests error, `db_count` is **0** forever. Take a
department that has switched its portal off: every call answers 503 from
`check_portal_enabled`, nothing is persisted, the in-memory tally climbs to
900 of 1 000, the reconciliation query answers 0, the tally is reset to 0, and
the loop repeats. The hourly key quota is never reached. The same undercount
applies in the ordinary case too, more mildly: the current request's own row is
not committed when the check runs, and neither are concurrent in-flight ones.

**Impact:** the second of the two layers protecting this surface (per-key
hourly) is bypassable by any API-key holder whose traffic does not persist a
log row; only the per-IP 100/min limiter remains, which permits ~6 000
requests/hour against a default 1 000/hour key ceiling. Requires a valid API
key, so it is a key-holder-abuse and noisy-neighbour issue rather than an
anonymous one.

**Fix:** `current_count = max(current_count, db_count)`, then write that back to
the cache. The database can still _raise_ a per-process tally to the
cross-process truth — the reason the query exists, and the case a
multi-worker deployment depends on — but it can no longer lower it.

**PUB-5b — the reconciliation query counted the wrong window — ✅ FIXED
(Codex, pass 4 round 2):** the fix above still scoped its `COUNT(*)` to a
rolling `now - 1 hour`, while `current_count` and `X-RateLimit-Reset` both key
off the fixed clock-hour bucket `hour_timestamp` starts. Shortly after a clock
hour turns over, the rolling window still includes the tail of the _previous_
bucket's traffic, and because the reconciled value can now only raise the
in-memory tally and never lower it, an inflated `db_count` from stale traffic
would stick in the new bucket for the rest of the hour — 429ing legitimate
requests until the bucket rolled over again. Fixed by scoping the query to
`datetime.fromtimestamp(hour_timestamp, tz=timezone.utc)` instead of `now -
timedelta(hours=1)`. `test_reconciliation_query_scopes_to_the_current_hour_bucket`
(`tests/test_public_portal_security.py`) captures the query's compiled lower
bound and asserts it equals the hour bucket's start; verified red against the
rolling-window version (asserted `2026-09-08T04:31:25...` — wall-clock minus
one hour — where `2026-09-08T05:00:00` — the bucket start — was expected).

#### PUB-6 — LOW — The data whitelist's default-deny path answered 500, not an empty document — ✅ FIXED

**What:** `portal.py` builds the full organization dictionary, runs it through
`filter_data_by_whitelist`, and constructs the response model from what
survives. Under Pydantic v2, `Optional[str]` **with no default is a required
field** that merely accepts `None` — and every field on
`PublicOrganizationInfo` and `PublicOrganizationStats` was declared that way.

**Where:** `app/schemas/public_portal.py:219-241` (pre-fix); the two call
sites are `app/api/public/portal.py:314` and `:411`.

**Failure scenario:** nothing seeds `public_portal_data_whitelist` — rows exist
only once an administrator adds them through `POST /whitelist`, and
`bulk-update` updates existing rows rather than creating any. So a fresh
deployment that enables the portal and issues a key gets `filtered_data == {}`,
`PublicOrganizationInfo(**{})` raises `ValidationError`, the handler's own
`except Exception` catches it, and `GET /organization/info` answers **500 to
every request** — as does `/organization/stats`. A partially-whitelisted
organization fares no better: nine of nine fields had to be enabled. Even then
`mailing_address` was typed `Dict[str, str]` while the handler builds it with a
`None` `line2`/`country`, so a complete whitelist could still 500 on a real
address. Verified against the real models
(`model_fields[...].is_required()` is `True` for all nine and all six) and by
constructing them.

**Impact:** availability, and a control whose safe default cannot express
itself. It fails _closed_ — the 500 body is the app's generic
`"Internal server error"`, so nothing leaks — but "no fields whitelisted" is
supposed to mean "an empty document", and it meant "a broken endpoint". Two
prior audits recorded "whitelist is default-deny"
(`docs/app-review/public-portal.md:137`) on the strength of the filter alone,
without ever exercising the model it feeds.

**Fix:** every field on both models now defaults to `None`, and the address
components are `Dict[str, Optional[str]]`. This exposes nothing new — the
whitelist filter upstream is untouched, and an un-enabled field serialises as
`null` rather than 500ing — and it is the shape
`docs/PUBLIC_API_DOCUMENTATION.md:145` already documents ("Only whitelisted
fields are returned. Some fields may be null if not configured").

#### PUB-7 — LOW — `GET /events/public` 500s whenever it is configured to return anything — ✅ FIXED (2026-09-24, PR #2665)

**What:** the handler emits `{title, description, start_datetime, end_datetime,
location, event_type}` per event; `response_model=list[PublicEvent]` requires
`{id, title, description, event_type, start_time, end_time, location,
is_public}`. Three of the eight names do not exist in what the handler
produces, and all eight are required.

**Where:** `app/api/public/portal.py:482-493` (the dict) vs
`app/schemas/public_portal.py:269-279` (the model).

**Failure scenario:** with **no** events field whitelisted, `filtered_event` is
`{}`, the `if filtered_event:` guard skips it, and the route returns `[]` —
which is why this has never been noticed. Whitelist even one events field and
have one upcoming non-cancelled, non-draft `PUBLIC_EDUCATION` event, and
FastAPI's response serialisation raises `ResponseValidationError` outside the
handler's `try`, producing a 500 from the global handler. Reproduced with the
real `PublicEvent` model and the handler's exact dictionary.

**Impact:** the department's public website gets a 500 exactly when an
administrator finishes configuring it. Availability only — fail-closed, generic
500 body, no leak.

**Why it was flagged rather than fixed:** unlike PUB-6, it could not be
repaired without deciding a public contract. `docs/PUBLIC_API_DOCUMENTATION.md`
documented the **schema's** field names — `start_time`, `end_time`, plus `id`
and `is_public` — so either
(a) the handler is re-keyed to the documented names, which silently voids any
`start_datetime`/`end_datetime` whitelist row an administrator has already
created and requires deciding whether the internal event `id` and `is_public`
should become whitelistable at all (a data-exposure decision on an
unauthenticated surface), or
(b) `PublicEvent` is re-declared to match the handler and made all-optional,
which contradicts the published documentation and any client written against
it. They are not equivalent, and the wrong one is worse than the 500.

**Decision (2026-09-24): (b), with the two open questions in (a) answered.**

_Why the handler's names win._ `public_portal_data_whitelist` rows are keyed
by `field_name`, so re-keying the handler to `start_time`/`end_time` orphans
every row an administrator has enabled — and PR #2665 landed a field catalogue
that now creates `events.start_datetime`/`end_datetime` rows for **every**
organization on first load of the Data Exposure Control screen. (a) would have
orphaned rows the same pull request creates.

_Why the documentation loses._ The clause "and any client written against it"
does not survive contact with the failure: the route answered 500 for every
non-empty result, so the documented shape had **never once been served**. No
working client can exist against it. The documentation described an intention,
not a contract, and was corrected to the shape the endpoint serves, with a
dated note saying so.

_`id` — whitelistable, not always-on._ Making it unconditional would have
broken this endpoint's stated invariant ("only whitelisted fields are
returned") with a field no administrator could switch off. It is now a
catalogue entry like any other, **disabled by default**, so the exposure
decision belongs to the department rather than to this fix.

_`is_public` — dropped, not renamed._ `Event` has no such column, so it was
never readable; and the query already restricts the list to non-cancelled,
non-draft, future `PUBLIC_EDUCATION` events, so the field could only ever have
serialized as a constant `true`. A constant is not a contract worth keeping.

_The route also gained `response_model_exclude_unset=True`_, which PUB-6
established as mandatory for a whitelist-filtered model and which this route
alone was missing — without it the `None` defaults that make an un-enabled
field constructible serialize back out as explicit nulls.

**Regression cover:** `tests/test_public_portal_whitelist_shape.py` adds
`PublicEvent` to `WHITELIST_FILTERED_MODELS` (the PUB-6 guard that would have
caught the required-fields half) and pins its field names to the field
catalogue in both directions;
`tests/test_public_portal_whitelist_catalogue.py` pins that catalogue to the
dictionary `portal.py` hands to `filter_data_by_whitelist`, read out of the
source by AST. A name that exists on only one of the three now fails a test
rather than a public website. Reverting `PublicEvent` to its pre-fix
declaration fails six of them. Mirrored into `docs/KNOWN_LIMITATIONS.md`.

#### PUB-8 — LOW — The public portal access log recorded successes only — ✅ FIXED (401 logging 2026-10-11, retention 2026-10-12)

**What:** `log_access` ends at `db.flush()`, so the row's fate is the request
transaction's — and `get_db` rolls that back on any raised exception. All six
`except` branches in `portal.py` log the failing status code and then re-raise,
so the row they wrote was discarded on the way out.

**Where:** `app/core/public_portal_security.py:282-283` (the flush);
`app/api/public/portal.py:318`/`:322`, `:415`/`:419` and `:508`/`:512` (the
six branches that log a failure and re-raise).

**Failure scenario:** `detect_anomalies` reads this table on every request and
has three signals; one of them counts rows with `status_code == 401` in the
last five minutes. **Nothing in `app/` has ever written a 401 row** — the only
caller of `log_access` is `portal.py`, and `authenticate_api_key` raises its
401 from the dependency, before the handler runs. So that branch was
unreachable, and the 503/404/500 rows the other branches did write were rolled
back. An operator reviewing the access log, or the "flagged suspicious" count
on the admin screen, saw only traffic that had succeeded.

**Impact:** detection and audit, not access control. It is also what made PUB-5
exploitable in the shape described above.

**Fix (the rollback half):** `log_public_api_request` now commits the row it
just wrote, guarded — a commit failure is logged and rolled back rather than
replacing the answer the caller was owed. Safe because these three handlers
write nothing else: the access-log entry is the only pending row, and the
session is created with `expire_on_commit=False`, so committing mid-handler
cannot expire an attribute a later line reads.

**Flagged (the 401 half):** logging a failed authentication needs
`PublicPortalAccessLog.organization_id` and `config_id` to be nullable — an
unknown API key cannot be attributed to an organization, and both columns are
`nullable=False` (`models/public_portal.py:202-211`), even though the model's
own comment beside `api_key_id` says "NULL if invalid/missing key". That is a
migration plus a decision about how an unattributable row is scoped for the
per-organization admin read, so it is not a security-review-iteration change.
Until then `detect_anomalies`' failed-auth branch stays dead; the per-IP
limiter and `suspicious_ip` are the controls actually covering that case.
Mirrored into `docs/KNOWN_LIMITATIONS.md`.

**Narrowed 2026-09-24 (PR #2665) — the 429 half is now recorded.** The
rate-limit refusal is raised from the same dependency and was invisible for
exactly the same reason, but it is _attributable_: by the time
`check_rate_limit` refuses, `authenticate_api_key` has already resolved the
key, so `organization_id` and `config_id` are in hand and none of the
nullability work above applies. `_log_refusal` writes the row and commits it
— flushing alone would lose it to the rollback the raise causes, which is
this finding's own mechanism — and is best-effort throughout: a logging
failure is warned and rolled back rather than replacing the 429 the caller
was owed.

This was not bookkeeping. The admin dashboard's "Rate Limits Hit" tile, and
the alert condition `rate_limit_hits_24h > 50` beside it, read a count of 429
rows that nothing had ever written, so adding the field without this would
have shipped a tile structurally pinned to zero — the same defect the rest of
that change set exists to remove. `tests/test_public_portal_usage_stats.py`
covers both halves: that the row is written, and that it survives a rollback
standing in for the request teardown. Removing the `_log_refusal` call fails
both.

**Narrowed 2026-10-12 (pass 8) — the revoked- and expired-key 401s are now
recorded too.** Re-reading `authenticate_api_key` for this pass surfaced that
the 429 fix's own reasoning — "the key is already resolved, so
`organization_id`/`config_id` are in hand" — applies just as directly to two
of the three 401 branches, not only to the 429 one. Only the "unknown key"
401 (`api_key_obj` is still `None`) is genuinely unattributable; the
"revoked" and "expired" branches run after the same `select` that resolves
the key, so they had every piece of information the 429 branch had and were
simply never given the same `_log_refusal` call. Before this, revoking a
compromised key and watching it keep getting hammered left **zero** trace in
`public_portal_access_log` — invisible to `detect_anomalies`'s per-IP 401
counter and to the `status_4xx_24h` / `error_rate_percentage` dashboard
tiles alike. Both branches in `authenticate_api_key` now call `_log_refusal`
before raising, exactly as the 429 branch does. Covered by
`TestRevokedAndExpiredKeysAreRecordedToo` in
`tests/test_public_portal_usage_stats.py` (four tests: each branch writes its
row, and one confirms the row survives the rollback the raise causes —
mirroring `TestTheRefusalIsRecorded`'s own coverage of that mechanism).

**The 401 half is now narrowed to a single branch.** Only the "unknown API
key" 401 — where no key resolved at all — remains blocked on the
`organization_id`/`config_id` nullable-column migration described above; it
is the one case with nothing to attribute the row to. `docs/KNOWN_LIMITATIONS.md`'s
PUB-8 row is updated to match.

**Resolved 2026-10-11 — the unknown-key 401 is recorded too.** Migration
`e6d21e605d99` made `organization_id`/`config_id` nullable, and
`authenticate_api_key` now logs every refusal; a row for a key that matches
nothing is platform-level (no organization). See the PUB-8 row in
`docs/KNOWN_LIMITATIONS.md` and `tests/test_public_portal_failed_auth_logging.py`.

**Retention resolved 2026-10-12 (owner decision).** Logging every 401 left
the residual that nothing pruned `public_portal_access_log`, so the table grew
with failed traffic and kept each requester's IP address indefinitely. The
new daily scheduled task `prune_public_portal_access_log`
(`run_prune_public_portal_access_log` in `app/services/scheduled_tasks.py`)
deletes rows older than `PUBLIC_PORTAL_ACCESS_LOG_RETENTION_DAYS` (90),
successful and refused alike and platform-wide (rows with no organization
included — a retention job, not a tenant read), selecting ids in batches of
1,000 and committing each delete. Every window the detector and usage
statistics read is at most 30 days, well inside the retention. Covered by
`tests/test_prune_public_portal_access_log.py` (old rows of every kind
deleted, recent kept, more than one batch). **PUB-8 is now fully resolved.**

#### PUB-9 — LOW — `response_model_exclude_unset` was missing, so the PUB-6 defaults round-tripped as explicit `null`s — ✅ FIXED

**What:** PUB-6 gave every field on `PublicOrganizationInfo` /
`PublicOrganizationStats` a `None` default so the models could be constructed
from a whitelist-filtered dict without raising. That fixed construction but
not serialisation: FastAPI's default response behaviour serialises every
declared field, default or not, so a field an administrator never whitelisted
came back as an explicit `"field": null` instead of being absent, and a
partial whitelist returned every field the whitelist had _not_ enabled right
alongside the ones it had — the inverse of "only whitelisted fields are
returned".

**Where:** `app/api/public/portal.py` — the `GET /organization/info` and
`GET /organization/stats` route decorators (neither set
`response_model_exclude_unset`).

**Fix:** both decorators now pass `response_model_exclude_unset=True`.
`PublicOrganizationInfo(**filtered_data)` only marks the whitelist-filtered
keys as "set" (`model_fields_set`), so `exclude_unset` reconstructs exactly
the whitelist's contract: an unwhitelisted field is omitted, and a whitelisted
field that happens to be empty still serialises as `null` (configured but
blank) rather than being dropped. Verified with the existing
`test_public_portal_whitelist_shape.py` suite (unaffected — it asserts on
`model_dump()` without `exclude_unset`, i.e. the model's own default-null
shape, not the route's wire shape) plus manual construction:
`PublicOrganizationInfo(name="x").model_dump(exclude_unset=True)` returns
`{"name": "x"}`, not the other eight keys as `null`.

Found by Codex on PR #2393, pass 4.

#### PUB-10 — LOW — The access-log commit ran before the response model was actually validated — ✅ FIXED

**What:** PUB-8 made `log_public_api_request` commit its row immediately so it
survives a raised `HTTPException`. All three success paths called it and then
_separately_ built the return value on the next line — `return
PublicOrganizationInfo(**filtered_data)` for the two organization routes,
`return events` (a list of plain dicts) for `/events/public`. FastAPI runs
`response_model` validation against the return value _after_ the handler
returns, outside the `try` these three routes commit inside. A failure at that
stage answers the client 500, but the 200 row was already committed and
`get_db` cannot roll it back on the way out — durable proof of a request the
security log now misreports as successful.

**Where:** `app/api/public/portal.py` — all three success paths
(`get_organization_info`, `get_organization_stats`, `get_public_events`).

**Failure scenario:** concretely reachable on `/events/public` today, via
PUB-7: whitelist one events field, have one matching upcoming event, and the
handler's dict is missing three fields `PublicEvent` requires. Before this
fix: `log_public_api_request(..., 200, ...)` commits, `return events` hands
FastAPI a list of dicts, response serialisation raises
`ResponseValidationError`, the client gets 500 — and the access log says 200.
The two organization routes were not concretely reachable the same way
(`PublicOrganizationInfo`/`Stats` have no required fields left after PUB-6),
but the ordering was identical and would have reopened the same class of bug
the moment either model gained a required field.

**Fix:** construct the response value — and thereby run the same validation
`response_model` would — _before_ calling `log_public_api_request`, still
inside the `try`. A `ValidationError` at construction now falls through to the
existing `except Exception` branch and logs 500, matching what the client
actually receives, instead of skipping validation until after 200 is already
durable. `/events/public` now builds a `PublicEvent(**filtered_event)` per
event inside the loop rather than appending the raw dict; this does not change
PUB-7's flagged status or its client-visible 500 — it only makes the access
log agree with the answer the client got. Verified with the full
`test_public_portal_whitelist_shape.py` and
`test_public_portal_access_log_persistence.py` suites (unaffected; neither
exercises FastAPI response serialisation) and by re-reading the reordered
control flow against `test_dependency_teardown_rolls_back_on_httpexception`'s
pinned `get_db` semantics.

Found by Codex on PR #2393, pass 4.

### Checked and deliberately not raised

Recorded so pass 5 does not spend the time again.

- **`token_expires_at` compared naive-to-aware.** `finance_service.py:967,1031`
  compare the column against `datetime.now(timezone.utc)` with no tzinfo
  normalisation, while `finance_approvals.py:113-116` and
  `training_session_service.py:1115` both normalise defensively — which reads
  like a `TypeError` waiting on a money path. It is not: `core/database.py:38`
  registers a global `load` listener that stamps every naive
  `DateTime(timezone=True)` attribute as UTC on ORM load. Traced before being
  written up; the defensive normalisations are belt-and-braces, not evidence of
  a bug.
- **The legacy-prefix bcrypt fan-out.** A caller sending an 8-character
  `X-API-Key` still selects every pre-PP-4 key whose stored prefix is the
  constant `"logbook_"` and bcrypt-verifies each. Bounded by the 100/min per-IP
  limit ahead of it and self-healing (each legacy key's prefix is upgraded on
  first successful use), and PP-4 already recorded it. Unchanged, not re-raised.
- **`get_user_by_calendar_token` does not filter `is_active`.** A deactivated
  member's ICS token keeps resolving. No practical exposure — the feed only
  returns that member's own non-cancelled shift assignments, which a
  deactivated member has none of going forward — and adding the filter is
  feature 15's call, not this one's.
- **`PublicFormResponse` returns `form.id`** despite the call site's comment
  saying "no internal IDs exposed". The slug already identifies the form to the
  same caller, so this discloses nothing the request did not carry.
- **A non-dict JSON body reaches `payload.get(...)` on the Salesforce route**
  (`salesforce_webhook.py:149`), where the other three receivers go through
  `_read_json`'s `isinstance(payload, dict)` guard. A valid HMAC over the body
  is required to get there, so the worst case is a 500 for someone holding the
  secret. Left alone rather than changed on an unauthenticated surface for a
  non-issue.

### Schema & migration notes

No drift, none written. The one schema change (PUB-6) is to Pydantic response
models, not to a table. PUB-8's flagged half would need a migration and is
recorded as such rather than started. PUB-3's `create_all`-only approval tables
remain accepted and unchanged.

### Guard tests added

- `TestCheckRateLimitDbReconciliation` (4 tests,
  `tests/test_public_portal_security.py`) — the reconciliation query must still
  run at the threshold and must still raise a low process-local tally, but must
  not lower one; and a repeated-check loop that pre-fix never limited now
  reaches the ceiling. Verified red against the pre-fix assignment (2 of 4).
- `tests/test_public_portal_whitelist_shape.py` (6 tests) — no field on either
  whitelist-filtered response model may be required, `model()` with nothing
  whitelisted must construct, a partial whitelist must construct, and address
  components may be null. The first is the ratchet: a new field added without a
  default fails it. Verified red against the pre-fix declarations (6 of 6).
- `tests/test_public_portal_access_log_persistence.py` (6 tests) — the access
  log is committed for 200/404/503/500 alike, a commit failure is swallowed and
  rolled back rather than becoming the caller's answer, and — separately — a
  real `TestClient` request pins the FastAPI behaviour the fix exists for, so
  if a future version stopped throwing into the `get_db` generator on an
  `HTTPException` the test says so instead of the fix quietly becoming
  redundant. Verified red against the pre-fix handler (5 of 6; the FastAPI
  behaviour test passes either way, by design).

### Completion gate

| Check                                                                             | Result                                                             |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `flake8 app/ tests/ alembic/` (7.3.0, flake8-pytest-style 2.2.0)                  | ✅ 0 violations                                                    |
| `black --check app/ tests/ alembic/` (26.5.1)                                     | ✅ 1 533 files unchanged                                           |
| `isort --check-only app/ tests/ alembic/` (9.0.1)                                 | ✅ clean                                                           |
| `validate_migrations.py --strict`                                                 | ✅ single head `1603bd9c59e7`                                      |
| scoped pytest (`-k "public or portal or webhook or salesforce or paypal or ..."`) | ✅ 495 passed, 1 skipped (`py_vapid` not installed — pre-existing) |
| ratchet suites (org-scoping, endpoint-auth, LIKE, CSV, capacity)                  | ✅ 56 passed                                                       |
| **full backend suite**                                                            | ✅ 11 831 passed, 21 skipped, 0 failed                             |
| `check_docs_links.py`                                                             | ✅ 0 broken links                                                  |
| `tsc --noEmit` / `eslint .`                                                       | n/a — no frontend file modified                                    |

---

## Pass 3 (2026-09-01) — re-verified, no new findings

**Scope — corrected mid-review by Codex.** The first cut of this section's
scope command was `git log 36ce7595..HEAD -- backend/app/api/public/`
(`36ce7595` is pass 2's own closing merge — the actual merge commit used as
the lower bound, not a date, per the methodology correction PERM-02's pass 3
recorded after Codex caught a missed commit there). That command only
covers the `app/api/public/` directory, but this feature's declared scope
is 12 files, one of which — `app/core/public_portal_security.py` (the
public portal's API-key resolution and rate-limit controls) — lives outside
that directory, in `app/core/`. The write-up below claimed that file
byte-identical on the strength of a command that never actually looked at
it. Re-run with the complete scope,
`git log 36ce7595..HEAD -- backend/app/api/public/ backend/app/core/public_portal_security.py`:
still exactly one commit, `b2b2c53c`, touching only `display.py` — the
substantive conclusion is unchanged, but it's now the command shown that
establishes it. File count unchanged at 12; route count unchanged at 20
(`grep -rc "@router\."` across all 12 files).

- **`b2b2c53c` — reorders `guest_check_in`'s rejection gates ahead of the
  per-event daily cap.** This is feature 32's (Locations & kiosk) own
  round-2 fix (LOC-32-4), not new work from this pass — cited and
  re-verified rather than re-derived. Before: the daily-cap check (an atomic
  Redis `INCR`, so asking the question spends an allowance slot) ran before
  the check-in-window-open and attendance-finalized checks, so refused
  traffic (before the window opens, or after attendance closes) could
  exhaust the day's cap and deny legitimate guests. After: both rejection
  gates run first; the cap is only spent by a request that would otherwise
  be accepted — the same ordering `event_requests.py`'s public submission
  endpoint already uses (EV-19). Confirmed the reorder is complete (both
  gates precede the cap check in the current file) and that it doesn't
  touch org/location scoping, which is resolved earlier in the same handler
  and unaffected by this diff. Already covered by a guard test in the
  originating PR; not re-added here.

**No new findings.** Pass 1/2's "Verified good" conclusions for the other
11 files (`portal.py`, `core/public_portal_security.py`, `calendar.py`,
`integrations_webhook.py`, `forms.py`, `paypal_webhook.py`,
`finance_approvals.py`, `legal.py`, `responses.py`, `salesforce_webhook.py`,
`security_txt.py`) stand — byte-identical since pass 2, confirmed via the
git log above. PUB-1, PUB-2, PUB-4 remain fixed; PUB-3 remains an accepted,
documented `create_all`-only table (not a defect).

**Completion gate:** no backend or frontend source file was modified by
this pass (the one code change in scope, `b2b2c53c`, predates this pass and
belongs to feature 32). `flake8 app/ tests/ alembic/` and
`python3 scripts/validate_migrations.py --strict` re-run directly to
confirm the baseline this pass sits on is clean; this pass's own PR's CI run
is the authority for the frontend gates and the full test suite, per the
same correction PERM-02 pass 3 recorded (cite the PR's own current-tree CI
run, not a prior PR's).

---

## Pass 2 (2026-08-27)

`git diff` between PR #1806's merge commit (`91406252`) and current `main`
touches only 3 of the 12 files in scope — `finance_approvals.py` (+6/-1),
`legal.py` (+33/-6), `portal.py` (+40/-4). The other 9, including
`display.py` (re-read in full at pass 1 for its guest-check-in growth), are
byte-identical. File count is unchanged at 12 (11 + `__init__.py`) — no new
public endpoint file since pass 1.

- **`finance_approvals.py`:** a new `BudgetLimitExceededError` (fail-closed
  overspend guard, feature 05's territory — `finance_service.py` itself grew
  +519 net lines, out of this feature's declared scope) is now caught and
  mapped to 409 in both `approve_via_token`/`deny_via_token`. Its message is
  a fixed, generic string (`"Insufficient available budget"`, no
  interpolated data) — safe to return raw. Verified PUB-4's self-approval
  guard (`approve_by_token`'s `SeparationOfDutiesError` check) and the
  `.with_for_update()` locking read (Pitfall #27) are both still present and
  still ordered before any state mutation — the new budget check fires later,
  inside `_finalize_approval`, after the guard, so it doesn't disturb the
  ordering PUB-4 depends on.
- **`legal.py`:** a correctness fix (DOC-10 finding: privacy policy and
  terms of service previously shared one `lastUpdated` date, so publishing
  one could misdate the other) — now two independent dated fields, with a
  deprecated `lastUpdated` kept for backward compatibility with the
  documented v1 API shape (a Codex finding on an earlier PR, already
  resolved before this pass). `_clean_text` (blocks HTML injection into the
  unauthenticated response) still wraps both new fields; the single-org
  guard (PUB-2) is untouched. No security-relevant change.
- **`portal.py`:** a genuine defense-in-depth fix connecting to feature 02's
  new `require_module` mechanism — `check_portal_enabled` now also checks
  the `public_info` module is enabled (via `OrganizationService
.get_enabled_modules(config.organization_id)`), because this router is
  mounted separately from the session-authenticated `/api/v1` tree
  `require_module` covers, so an API-key caller could keep reading
  organization info/stats/events after an admin turned the module off.
  Applied to all three of this router's module-gated routes
  (`get_organization_info`/`get_organization_stats`/`get_public_events`) —
  confirmed by checking every `check_portal_enabled` call site. The other
  two public routes in this file (`get_application_status`,
  a per-prospect-token endpoint unrelated to the portal API-key system; and
  `health_check`) were correctly left alone — neither was gated by portal
  enablement before this diff either.

**No findings.** No code changes this pass — the changes since pass 1 were
already-complete fixes for other rotation findings (PUB-4 area, DOC-10) and
one new defense-in-depth improvement, none of which introduced a gap.

**Completion gate (pass 2):** flake8/black/isort clean on `app/ tests/
alembic/`; `validate_migrations.py --strict` passed (381 revisions, single
head); pass-1 guard tests (`test_salesforce_webhook.py`,
`test_finance_approval_tokens.py`) 10/10 pass; broader scoped tests (`-k
"finance or legal or public_portal or portal or webhook or salesforce or
display or calendar or security_txt or forms"`) 366 passed, 1 skipped
(pre-existing); full backend suite 9040 passed, 22 skipped (pre-existing),
0 failed. No frontend files touched.

---

## Pass 1 (2026-08-25)

**Backend:** all 12 files under `app/api/public/` (2317 L total) —
`portal.py`, `core/public_portal_security.py`, `calendar.py`, `display.py`,
`integrations_webhook.py`, `forms.py`, `paypal_webhook.py`,
`finance_approvals.py`, `legal.py`, `responses.py`, `salesforce_webhook.py`,
`security_txt.py`
**Frontend:** none touched
**Migrations:** none touched (finding on `ApprovalChain`/`ApprovalChainStep`/
`ApprovalStepRecord` is informational, not a fix)

---

## Scope

Every route here is intentionally unauthenticated — that is what makes it
"public." Six of the twelve files already carry thorough prior coverage
(`docs/module-audit/public-portal.md` + `docs/app-review/public-portal.md`,
4 passes through 2026-08-09, for `portal.py`/`public_portal_security.py`/
`calendar.py`/`display.py`; `docs/module-audit/integrations.md` +
`docs/app-review/integrations.md` for `integrations_webhook.py`;
`docs/module-audit/forms.md` + `docs/app-review/forms.md` for `forms.py`;
`docs/module-audit/storefront.md` for `paypal_webhook.py`). Those were
spot-checked rather than re-derived — full write-up below.

**`display.py` was re-read in full**, not spot-checked: it grew from 119 to
401 lines since the last audit (the entire guest QR check-in feature was
added). **Five files carry no prior audit at all** and were read in full
against all seven checklist dimensions: `finance_approvals.py`, `legal.py`,
`responses.py`, `salesforce_webhook.py`, `security_txt.py`.

Since dimension 1 ("every route carries an auth dependency") is trivially
"no" for every route in this feature by design, it was reframed per-route as:
what is the **compensating control** (rate limit, signed/high-entropy token,
webhook signature, API key, or "truly public, nothing to protect")?

## Route inventory — newly-reviewed files

| File                    | Route                                             | Compensating control                                                                                                | Org-scoped                           | Notes                             |
| ----------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------ | --------------------------------- |
| `finance_approvals.py`  | `GET /approvals/{token}`                          | 256-bit token, 30/min/IP                                                                                            | via token→record                     | step name/status only, no amount  |
| `finance_approvals.py`  | `POST /approvals/{token}/approve`                 | same + `.with_for_update()` locking read                                                                            | via token→record                     | only `notes` client-writable      |
| `finance_approvals.py`  | `POST /approvals/{token}/deny`                    | same                                                                                                                | via token→record                     | same                              |
| `salesforce_webhook.py` | `POST /webhooks/salesforce/{integration_id}`      | HMAC-SHA256, fail-closed if unconfigured, 30/min (60s window, no added lockout — corrected in INT-27), replay guard | via `integration.organization_id`    | see PUB-1                         |
| `legal.py`              | `GET /legal`                                      | 30/min/IP; single-tenant-only guard                                                                                 | n/a (anonymous)                      | see PUB-2 (doc only)              |
| `responses.py`          | n/a — shared OpenAPI response shapes, no route    | n/a                                                                                                                 | n/a                                  | no runtime effect                 |
| `security_txt.py`       | `GET /.well-known/security.txt`                   | none needed — server config only, no request input consumed                                                         | n/a                                  | RFC 9116                          |
| `display.py`            | `GET /display/{code}`                             | 60/min/IP, ASCII code regex                                                                                         | via `location.organization_id`       | unchanged from prior audit        |
| `display.py`            | `GET /display/{code}/events/{id}/guest`           | same                                                                                                                | via location org **and** location id | new                               |
| `display.py`            | `POST /display/{code}/events/{id}/guest-check-in` | 10/min+lockout, honeypot, per-event daily cap                                                                       | same                                 | new — full guest check-in feature |

## Verified good ✅

- **`finance_approvals.py` token scheme is solid.** 256 bits of entropy
  (`secrets.token_urlsafe(32)`), 7-day TTL, single-use (token cleared to
  `None` on use), status re-validated to `PENDING` before any write, and the
  mutating fetch uses `.with_for_update()` (`finance_service.py:718,753`) —
  correctly following Pitfall #27 (capacity/state check as a locking read),
  closing the double-approve race a plain re-check would miss.
- **`salesforce_webhook.py` matches the audited `integrations_webhook.py`
  pattern exactly.** HMAC-SHA256 via `hmac.compare_digest`
  (`salesforce_webhook.py:94-95` pre-fix numbering), fails closed with 401 if
  no `webhook_secret` is configured, rate-limited (30/min + 5-min lockout)
  before any DB/HMAC work, replay-protected via the same `is_duplicate_webhook`
  helper. Org resolution never trusts the payload: the integration row's own
  `organization_id` is the only source, and inbound sync's `rank` exclusion
  (verified against CHANGELOG 2026-08-11/12) still holds — a forged/leaked
  webhook secret cannot promote a member's rank.
- **`display.py`'s new guest check-in feature is tenant-safe and
  abuse-resistant.** Org+location resolution is display-code-first by
  explicit design (a leaked code for Room A can't be combined with an
  `event_id` from Room B); every failure path (unknown code, wrong room,
  feature disabled) answers an identical 404, so the endpoint can't be used
  to enumerate which rooms/events exist. Honeypot + a per-event/day cap sit
  alongside the per-IP rate limit specifically because a distributed flood
  defeats per-IP limiting alone and each sign-in has a real side effect
  (a pipeline record). `GuestCheckInResponse` correctly omits
  `prospect_created` (verified against the CHANGELOG 2026-08-11 fix closing
  a prospect-existence enumeration channel) — the field is still computed
  for the audit log only.
- **No injection surface, no unbounded cache, no TODO/FIXME** across any of
  the 12 files.
- **Spot-checks all held** — `portal.py`'s org-scoping, `public_portal_security.py`'s
  selective-prefix + rate-limit-before-bcrypt ordering + bounded caches,
  `calendar.py`'s CSPRNG token + full ICS escaping, `integrations_webhook.py`'s
  signature/replay/org-scoping, `forms.py`'s slug validation + CAPTCHA/honeypot,
  and `paypal_webhook.py`'s signature/replay/audit-logging are all present and
  unchanged in mechanism at their current (drifted) line numbers.

## Findings

### PUB-1 — LOW — Salesforce inbound webhook had no cap on payload record count — ✅ FIXED

**What:** `records = payload.get("records", [])` had no length limit before
each record triggered 1-2 DB queries via `sync_service.sync_inbound_contacts`.

**Where:** `app/api/public/salesforce_webhook.py:143` (pre-fix).

**Failure scenario:** the endpoint is rate-limited per-request (30/min), not
per-record. A party in possession of a valid (or compromised/leaked)
`webhook_secret` could send one oversized, validly-signed request to run an
effectively unbounded number of DB round-trips within that same 30/min
budget. This requires the secret already — not reachable by an
unauthenticated attacker — but every other public write in this feature
(guest check-in's daily cap, the API-key rate limiter's bucket caps) has an
explicit ceiling, and this one didn't.

**Fix:** added `MAX_RECORDS_PER_WEBHOOK = 500`; a request exceeding it gets a
422 before any sync work runs, following the same shape as the existing
`MAX_PHOTOS_PER_ITEM` cap pattern in `equipment_check.py`.

**Fix, round 2 (caught by Codex review on the PR, before merge):** the first
version of this fix placed the new cap check _after_ the existing
`is_duplicate_webhook` replay guard. That guard marks a delivery "seen" via
an atomic `SET NX` the moment it's called — so an over-cap request still got
fingerprinted even though it was then rejected with 422. A provider's
identical retry of that same oversized payload would hit the duplicate
branch and get **200**, which stops the provider from retrying — silently
dropping the batch forever instead of ever being retried at a size the cap
allows. Fixed by moving all payload-shape validation (JSON parse, `sobject`/
`records` presence, the record-count cap) **before** the replay check, so
only a request that's actually going to be processed — or already
duplicate-rejected on its own separate merits — gets fingerprinted.

**Guard tests:** `tests/test_salesforce_webhook.py` —
`test_rejects_payload_over_the_cap` (501 records → 422, matches the cap
number), `test_at_the_cap_passes_the_check` (exactly 500 records reaches the
sync path, proving the boundary is inclusive rather than off-by-one), and
`test_over_cap_payload_is_not_fingerprinted_as_seen` (asserts
`is_duplicate_webhook` is never awaited when the cap rejects a request —
fails if the ordering regresses).

### PUB-2 — NIT — `legal.py`'s single-org guard was correct but unexplained — ✅ FIXED (comment only)

`len(orgs) == 1` (`legal.py:75`) is the only thing preventing a multi-tenant
deployment from leaking an arbitrary organization's legal text to every
anonymous caller (this endpoint has no org context at all — no API key, no
subdomain routing). The code was already correct; added a comment naming the
invariant so a future "simplify this to `.first()`" edit doesn't reintroduce
the leak.

### PUB-4 — MED — Finance token-based approval had no self-approval guard, despite the documented invariant — ✅ FIXED

**What:** `approve_by_token`/`deny_by_token` never called
`assert_different_person()` the way the authenticated `approve_step` does.
The initial pass through this file recorded that as **verified safe**,
reasoning that the token path's approver has no Logbook account/id to
compare against a requester id. **A Codex review comment on the PR correctly
identified this reasoning as incomplete**, and it was wrong to close as a
non-finding: for an `approver_type == EMAIL` step, the approver's identity
_is_ knowable — it's the literal email address on `step.approver_value`.

**Where:** `app/services/finance_service.py:711` (pre-fix).

**Failure scenario:** if a chain step's `approver_value` is configured to
the same email address as the person who submits the request it's meant to
gate (plausible in a small department — e.g. a Treasurer step where the
Treasurer is also the usual requester, or simple misconfiguration), that
person receives the approval-request email themselves and can click through
and approve their own purchase/expense/check request with **zero** guard —
directly contradicting `docs/FINANCE_MODULE.md:181`'s documented invariant
("`allow_self_approval`: By default false — prevents the requester from also
being the approver at any step"). `allow_self_approval` exists specifically
to gate this and defaults to `False`, but nothing read it on this path.

**Fix:** `approve_by_token` now eager-loads `record.step` and, when
`step.approver_type == ApproverType.EMAIL` and `not step.allow_self_approval`,
resolves the requester's email (new `_entity_creator_email` helper, mirroring
the existing `_entity_creator_id`) and compares it case-insensitively against
`step.approver_value`. A match raises `SeparationOfDutiesError` (a
`ValueError` subclass — the endpoint's existing `except ValueError → 400`
mapping picks it up unchanged, no endpoint-layer change needed). Steps using
`POSITION`/`PERMISSION`/`SPECIFIC_USER` approver types are untouched by this
check (no email to compare — the original "no Logbook identity to compare
against" reasoning does hold for those three, just not for `EMAIL`).
`deny_by_token` is deliberately left unguarded, matching the existing
`approve_step`/`deny_step` asymmetry: withdrawing your own request is not a
separation-of-duties conflict, only approving it is.

**Guard tests:** `tests/test_finance_approval_tokens.py` —
`TestApproveByTokenSelfApprovalGuard` covers: rejects when the approver email
matches the requester (case-insensitively), allows when the step explicitly
sets `allow_self_approval=True`, allows when the emails differ, and allows
all three non-`EMAIL` approver types unconditionally.

### PUB-3 — INFO — `ApprovalChain`/`ApprovalChainStep`/`ApprovalStepRecord` have no Alembic migration — not a defect, flagging for the record

No migration creates these three tables — they exist only via the
`create_all` + `_add_missing_model_columns` startup path (Pitfall #26
territory, consistent with the ~39 other tables already documented as
`create_all`-only). The schema itself is correct (`SET NULL` FKs are
`nullable=True`, `models/finance.py:365,433,483,486`). Not fixed because
nothing is wrong to fix — recorded so it's an explicit "yes, intentional"
rather than a silent gap the next reviewer has to rediscover.

## Schema & migration notes

No drift found. `ApprovalChain`/`ApprovalChainStep`/`ApprovalStepRecord`
`SET NULL` FKs are correctly `nullable=True` (see PUB-3). No other model
behind these 12 files was touched this iteration.

## Guard tests added

- `test_rejects_payload_over_the_cap` / `test_at_the_cap_passes_the_check` /
  `test_over_cap_payload_is_not_fingerprinted_as_seen`
  (`tests/test_salesforce_webhook.py`) — fail if the record-count cap
  regresses, its boundary becomes off-by-one, or the replay-fingerprint
  ordering regresses.
- `TestApproveByTokenSelfApprovalGuard` (5 tests,
  `tests/test_finance_approval_tokens.py`) — fail if the token-approval
  self-approval guard regresses, stops respecting `allow_self_approval`, or
  starts blocking non-`EMAIL` approver types it shouldn't.

## Completion gate

| Check                                                                   | Result                                                              |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `flake8 app/ tests/ alembic/`                                           | ✅ 0 violations                                                     |
| `black --check app/ tests/ alembic/`                                    | ✅ unchanged                                                        |
| `isort --check-only app/ tests/ alembic/`                               | ✅ clean                                                            |
| `validate_migrations.py --strict`                                       | ✅ single head                                                      |
| backend tests (scoped: finance/legal/public/webhook/salesforce/display) | ✅ 256 passed, 1 skipped (environment-only: py_vapid not installed) |
| `tsc --noEmit`                                                          | ✅ 0 errors (no frontend files touched)                             |
| `eslint .`                                                              | n/a — no frontend files touched                                     |
