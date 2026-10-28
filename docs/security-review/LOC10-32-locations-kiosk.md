# Security Review — Feature 32: Locations & Kiosk (pass 10)

**Prefix:** `LOC10` · **Iteration:** 32 · **Reviewed:** 2026-10-27 · **PR:** (this PR)

**Backend:** `app/api/v1/endpoints/locations.py` (8 routes), `app/services/location_service.py`, `app/api/public/display.py` (6 routes — **+2 since pass 9**), `app/api/v1/endpoints/admin_hub.py` (3 routes), `app/services/admin_hub_service.py`, `app/models/location.py`, `app/models/admin_hub.py`, `app/schemas/location.py`, `app/schemas/admin_hub.py`. Also read: `app/services/guest_check_in_service.py` (the service `display.py`'s guest routes call directly — not previously declared in this feature's own file list, but its two new methods back the two new routes and were read in full), `app/schemas/event.py` and `app/core/error_codes.py` (the two new request/response schemas and the one new error code the new routes use).
**Frontend:** `pages/LocationsPage.tsx`, `pages/RoomQRCodesPage.tsx`, `pages/LocationKioskPage.tsx`, `components/admin/AdminHubFrame.tsx`. Also read: `pages/GuestCheckInPage.tsx` and `components/GuestEmailSignIn.tsx` — the frontend consumers of `display.py`'s guest-check-in/-lookup/-confirm routes, reached by scanning a QR code tied to a room's display code (not previously declared in this feature's own frontend scope, but they render exactly the public kiosk API this feature owns).

**Watchdog pickup** — the dedicated `/loop 30m /security-review` session was reported unreachable by the operator starting this run. No security-review PR was open — confirmed via `search_pull_requests` (`is:pr is:open head:claude/security-review-`), 0 results, checked immediately before starting. PR #3786 (Feature 31, Scheduled tasks, pass 10) had already merged into `main`; the rotation table already carried row 31 at ✅ from that merge. Row 32 was confirmed the next `⬜` row by reading the table directly on a freshly-fetched `main`.

---

## Scope

Pass 9's baseline is PR #3677, tip `5d38437a` (merged 2026-10-25). A path-scoped
`git log 5d38437a..HEAD` against this feature's own declared backend/frontend
files found exactly two commits:

| Commit     | What it did here                                                                                                                                                                                                                                                                            |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `dd034161` | Adds email-first guest sign-in for pipeline-linked events: two new public routes in `display.py` (`guest-lookup`, `guest-confirm`), two new methods on `GuestCheckInService`, new schemas, one new error code. The typed `guest-check-in` route now refuses pipeline events (`LB-EVT-006`). |
| `19fe610e` | A11y/touch-target sweep. Touches `RoomQRCodesPage.tsx` for one line: `max-w-xs flex-1` → `field-min relative max-w-xs flex-1` on the search field. Tailwind utility only, no logic change.                                                                                                  |

**Not re-read, byte-identical to the pass-9 baseline** (confirmed by empty
`git diff 5d38437a..HEAD --`): `endpoints/locations.py`, `services/location_service.py`,
`endpoints/admin_hub.py`, `services/admin_hub_service.py`, `models/location.py`,
`models/admin_hub.py`, `schemas/admin_hub.py`, `components/admin/AdminHubFrame.tsx`,
`pages/LocationsPage.tsx`, `pages/LocationKioskPage.tsx`. `schemas/location.py` is
also unchanged since pass 9 (pass 9 already covered its `le=INT32_MAX` bound).

**Two commits that touch this feature's shared frontend component but belong
to a different feature, not independently re-reviewed here:** `b5a6fbf1`
("Give public events their own guest check-in QR code", Feature 16 — Events &
requests) and `43c11090` ("Match emails by fingerprint and keep addresses out
of new audit entries", a 23-file app-wide sweep). Both post-date `dd034161`
and are already on `main`. `b5a6fbf1` refactored `GuestEmailSignIn.tsx`'s
props from `code`/`eventId` to a generic `apiBase`, so the same component now
also serves Feature 16's new standalone `event_guest.py` surface — read only
to confirm the component still behaves identically when called from this
feature's own `display.py` routes (it does; see Verified good). `43c11090` is
the subject of LOC10-1 below.

**One migration touches a column this feature's model declares, outside this
feature's own files, already reviewed by Feature 31's pass 9 for its own
scheduled-task caller:** `20261023_1916_a8c3b50b6d9b` (`nfc_card_taps.location_id`,
`ON DELETE SET NULL`, `nullable=True`) — predates this pass's window (merged
before pass 9), re-confirmed unchanged below under Schema & migration notes.
No new migration lands in `5d38437a..HEAD` against any table this feature's
models declare or any table with a FK to `locations.id`.

## Route inventory

Enumerated by walking every `@router.<method>` decorator in the three files
via AST (`ast.walk`, not a grep), cross-checked against each handler's
`Depends`/`dependencies=` wiring: **17 routes, up from 15 at pass 9** — the two
new ones are exactly `dd034161`'s addition.

| Method | Path                                                       | Auth dependency           | Permission                            | Org-scoped                                                                                                                         |
| ------ | ---------------------------------------------------------- | ------------------------- | ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/locations`                                               | `get_current_user`        | none (read)                           | yes                                                                                                                                |
| POST   | `/locations`                                               | `get_current_user`        | `locations.create` OR `.manage`       | yes                                                                                                                                |
| GET    | `/locations/{id}`                                          | `get_current_user`        | none (read)                           | yes                                                                                                                                |
| PATCH  | `/locations/{id}`                                          | `get_current_user`        | `locations.edit` OR `.manage`         | yes                                                                                                                                |
| DELETE | `/locations/{id}`                                          | `get_current_user`        | `locations.delete` OR `.manage`       | yes                                                                                                                                |
| POST   | `/locations/{id}/regenerate-display-code`                  | `get_current_user`        | `locations.edit` OR `.manage`         | yes                                                                                                                                |
| PUT    | `/locations/{id}/badge-check-in`                           | `get_current_user`        | `locations.manage_nfc_tags`           | yes                                                                                                                                |
| GET    | `/locations/{id}/display`                                  | `get_current_user`        | none (read)                           | yes                                                                                                                                |
| GET    | `/api/public/v1/display/{code}`                            | none (public)             | n/a                                   | via `display_code`; `_rate_limit_display`                                                                                          |
| POST   | `/api/public/v1/display/{code}/badge-tap`                  | none (public)             | n/a                                   | via `display_code`; `_rate_limit_badge_tap_ip`                                                                                     |
| GET    | `/api/public/v1/display/{code}/events/{id}/guest`          | none (public)             | n/a                                   | via `display_code`; `_rate_limit_display`                                                                                          |
| POST   | `/api/public/v1/display/{code}/events/{id}/guest-check-in` | none (public)             | n/a                                   | via `display_code`; `_rate_limit_guest_check_in`                                                                                   |
| POST   | `/api/public/v1/display/{code}/events/{id}/guest-lookup`   | none (public) **← new**   | n/a                                   | via `display_code`; `_rate_limit_guest_lookup` (new: 10/min/IP, 600s lockout) + per-event daily cap                                |
| POST   | `/api/public/v1/display/{code}/events/{id}/guest-confirm`  | none (public) **← new**   | n/a                                   | via `display_code` + signed, 10-minute, event/room/org-bound token; shares `_rate_limit_guest_check_in` + the attendance daily cap |
| GET    | `/admin-hub/{module_key}/summary`                          | `get_current_active_user` | `spec.permission` (inline, see below) | yes                                                                                                                                |
| GET    | `/admin-hub/{module_key}/metrics`                          | `get_current_active_user` | `spec.permission` (inline)            | yes                                                                                                                                |
| PUT    | `/admin-hub/{module_key}/metrics`                          | `get_current_active_user` | `spec.permission` (inline)            | yes                                                                                                                                |

No drift on the 15 unchanged routes — same paths, methods, permission strings
as pass 9's table.

## Verified good ✅

- **The two new public routes are rate-limited before any expensive work.**
  `guest_lookup` carries `_rate_limit_guest_lookup` (10/min per IP, 10-minute
  lockout on breach — `display.py:113`), and also spends a **separate**
  per-event daily cap (`guest_lookup:{event.id}`) distinct from the
  check-in cap, so pure lookups cannot exhaust the real attendance ceiling and
  vice versa. `guest_confirm` shares `_rate_limit_guest_check_in` and the
  `guest_checkin:{event.id}` cap with the typed form and the existing
  `guest_check_in` route — correct, since both write real attendance and the
  cap exists to bound that write regardless of path.
- **The window/finalized/pipeline gates run before either cap is spent**, on
  both new routes (`_assert_guest_sign_in_open`, `_require_email_first`,
  `display.py:237,256`) — matching the ordering rule the module's own comment
  states for `guest_check_in` (EV-19): a rejection must run before the counter
  increment, or refused traffic spends real allowance.
- **The honeypot answer is indistinguishable from a genuine miss and is
  returned before either gate.** `guest_lookup` returns the identical
  `LOOKUP_NOT_FOUND`/`not_found_message` pair a real unknown email gets,
  checked before `_assert_guest_sign_in_open` — so a bot cannot use the
  honeypot response to learn whether an event's sign-in window is open.
- **The confirm token is a true capability, not a client-asserted identity.**
  `issue_confirm_token`/`read_confirm_token` (`guest_check_in_service.py:542,569`)
  are a signed JWT (`settings.SECRET_KEY`, HS256, explicit `algorithms=["HS256"]`
  — no algorithm-confusion surface) binding `sub` (prospect id), `evt`, `loc`,
  `org` and a 10-minute `exp`; `read_confirm_token` fails closed (returns
  `None`) on anything that isn't that exact type for that exact
  event/room/org, verified by a dedicated test class (`TestConfirmToken`,
  8 tests: wrong event, wrong room, wrong org, expired, wrong signing key, a
  real session token, garbage). The browser never names the prospect — only
  the token does — so `handleConfirm` in `GuestEmailSignIn.tsx` cannot be
  made to check in anyone it did not itself look up.
- **`check_in_known_prospect` re-reads the prospect rather than trusting the
  token's claims against current state.** `guest_check_in_service.py:601`
  re-queries `ProspectiveMember` by id **and** `status == ACTIVE` at confirm
  time, closing the race where an applicant is withdrawn in the window between
  lookup and confirm — covered by `test_applicant_withdrawn_between_taps_is_refused`.
- **The lookup is tenant-isolated the same way the rest of this feature's
  public surface is.** `organization_id` comes from `_resolve_guest_event`
  (unchanged since pass 8 — the display code, not the request, determines the
  org), and both the prospect query (`find_active_prospect_by_email`, via
  `email_hash`) and the member query (`email_hash.in_(email_fingerprints(...))`,
  see LOC10-1) filter on it. `test_another_departments_applicant_is_not_recognised`
  and `TestConfirmToken.test_another_department_is_refused` both exercise this
  directly.
- **Every lookup and sign-in is audited by outcome and id, never the typed
  email.** `event_guest_lookup`'s `event_data` carries `event_id`,
  `location_id`, `outcome`, `prospect_id` (nullable), `source` —
  `display.py`'s `guest_lookup` handler, matching checklist §5 and Pitfall
  #33's "an id rather than user-supplied text where the id is enough."
- **`_require_email_first`'s refusal is the same 404 as every other
  unavailable sign-in** (`EVT_SIGNIN_UNAVAILABLE`, matching
  `_resolve_guest_event`'s own not-found), so the pair cannot be used to
  learn which events are pipeline-linked without already knowing the
  display code and a valid event id for that room.
- **The typed form cannot be used to bypass the email-first gate.**
  `guest_check_in` now refuses with `LB-EVT-006` whenever
  `event.guest_check_in_creates_prospect` is set (`display.py:518`), so the
  prospect-creating branch of `check_in_guest` is unreachable from an
  anonymous POST at a pipeline event — covered by
  `test_typed_form_is_refused_and_opens_no_applicant`.
- **No new `window.confirm`/`alert`/`prompt`, and no modal.**
  `GuestEmailSignIn.tsx` is a page section, not a fixed-position dialog, so
  Pitfall #21's height cap doesn't apply; its two destructive-looking actions
  ("Yes, check me in" / "That's not me") are plain buttons with named
  consequences, matching Pitfall #16's spirit even though neither is an
  `useConfirm()` candidate (confirming your own identity isn't a destructive
  action on someone else's data).
- **No LIKE pattern, no raw SQL, no CSV export in the new code** — `email`
  matches are either `EmailStr`-validated equality (via fingerprint, see
  LOC10-1) or a hash-set membership test; checklist §4 n/a beyond that.
- **Error responses leak nothing new.** `guest_confirm`'s `ValueError`/
  generic-`Exception` branches both go through `safe_error_detail()`
  (`display.py:741,745`), matching the rest of this file.
- **The schema fields are validated at the edge.** `GuestLookupRequest.email`
  is `EmailStr` (not a bare string); `GuestConfirmRequest.confirm_token` is
  length-capped (`max_length=2048`), so an oversized token is a 422 before it
  reaches `jwt.decode`.
- **The a11y touch-target fix (`19fe610e`) changes no logic** — a Tailwind
  utility class on a search input, confirmed by diff.
- **LocationsPage.tsx, LocationKioskPage.tsx, AdminHubFrame.tsx,
  locations.py, location_service.py, admin_hub.py, admin_hub_service.py,
  both model files, both admin_hub schema files are byte-identical to the
  pass-9 baseline** — confirmed by `git diff`, not inherited.
- **All prior-pass findings remain fixed.** LOC8-1's guard test
  (`test_location_restrict_references.py`) still passes (3/3) against the
  current, now-14-FK schema; re-derived the full FK-to-`locations.id` list
  directly from `Base.metadata` rather than trusting either pass's count: 5
  blocking (`RESTRICT`), 9 non-blocking (`SET NULL`) — unchanged from pass 9.

## Findings

### LOC10-1 — MEDIUM — the kiosk's "is this a member" lookup briefly compared a plaintext email against an encrypted column — ✅ FIXED (by a prior commit; re-verified, not a defect at current HEAD)

**What:** `GuestCheckInService.lookup_guest`, as introduced by `dd034161`
(2026-10-25 14:47 UTC), classified a member account with
`select(User.id).where(..., func.lower(User.email) == normalized, User.is_active)`.
`User.email` is `EncryptedText` (AES-256-GCM, random nonce per write — see
`app/core/encrypted_types.py`): confirmed empirically that
`func.lower(User.email)` compiles to `NullType()`, so SQLAlchemy binds the
right-hand literal as a plain `String()`, not through the column's
`process_bind_param`. The compiled predicate is `LOWER(<ciphertext>) = <plaintext>`,
which can never match a real encrypted row.
**Where:** `app/services/guest_check_in_service.py:518` (current line; the
defect existed only in the version `dd034161` introduced, between that
commit and the fix below).
**Failure scenario, as it stood for roughly 21 hours of this feature's
history:** a genuine department member types their own email at a
pipeline-linked event's kiosk. `lookup_guest` finds no prospect, then runs
the broken member query, which matches nothing against real encrypted data —
so the member falls through to `LOOKUP_NOT_FOUND` and is told "We couldn't
find you. Please see a member of staff," instead of "This looks like a member
account — scan the member QR code." No check-in is falsified and no data
leaks (the safe direction to fail in), but the member-recognition branch this
endpoint exists to provide was dead code against production data.
**Impact:** functional/UX only in the direction it failed, but it is the same
class of defect a repo-wide sweep was needed to close everywhere else (see
below) — worth recording precisely because it is exactly the kind of "looks
correct, type-checks, passes its own test" bug CLAUDE.md Pitfall #34 and
#37 warn about.
**Fix:** already applied, not by this pass. Commit `43c11090` ("Match emails
by fingerprint and keep addresses out of new audit entries", 2026-10-26
11:51 UTC, 23 files) rewrote every SQL comparison against an encrypted email
column app-wide, including this one, to `User.email_hash.in_(email_fingerprints(normalized))`
— the pattern already used by `auth_service.py`, `oauth_service.py`, and 20
other call sites. Re-verified directly against the current file
(`guest_check_in_service.py:518`, quoted above in **Verified good**) and by
compiling the old expression in isolation to confirm the mechanism, rather
than trusting the commit message. No further action needed in this feature's
own files.

### LOC10-2 — LOW — the test fixture that exercises this lookup bypasses the encryption layer it is meant to prove correct — 🚩 FLAGGED

**What:** `backend/tests/test_guest_email_first_sign_in.py`'s `_member()`
helper creates the "department member" row with a raw
`INSERT INTO users (..., email, email_hash, ...) VALUES (..., :em, :fp, ...)`,
binding the **plaintext** email directly to the `email` column — bypassing
`EncryptedText.process_bind_param` entirely, since a `text()` statement does
not go through the ORM's mapped-column type. `email_hash` is set correctly
(via `email_fingerprint(email)`), so the test only ever exercises the
`email_hash` branch, never the ciphertext-comparison bug LOC10-1 describes.
**Where:** `backend/tests/test_guest_email_first_sign_in.py:371` (the
`_member` helper); the same shape — a raw INSERT with a plaintext `email` and
no `email_hash` at all — is `setup_org_and_admin` in `tests/conftest.py:244`,
shared across a large number of unrelated test files, with its own
documented rationale (avoiding password hashing and onboarding defaults for
rows that only need to exist for a foreign key).
**Failure scenario:** confirmed empirically — I ran
`test_member_account_is_pointed_at_the_member_code` and
`test_probationary_member_is_a_member` against the file as it stands
(33/33 passed) and separately confirmed, by direct inspection of
`func.lower(User.email)`'s compiled SQL type, that the _original_
(pre-`43c11090`) query could not have matched a real `EncryptedText` row. Had
`43c11090` never landed, these two tests would have kept passing anyway,
because their fixture's "member" row was never really encrypted. This is
Pitfall #37's exact shape: a passing test that was never capable of catching
the regression it exists to guard.
**Impact:** no current defect — the production query is correct (LOC10-1).
The residual risk is that a _future_ regression of this same kind, in this
same method, would again pass this file's own tests.
**Fix:** not applied this pass. Closing it means either (a) switching
`_member()` to construct a real `User()` through the ORM so `email` is
genuinely encrypted on write, which needs the model's ~30 other non-nullable
columns supplied or defaulted and risks drifting from the deliberately
minimal `setup_org_and_admin` convention this test file's sibling helper
follows, or (b) adding a narrow, standalone unit test that writes a `User`
through the ORM in a throwaway session and asserts the raw column value is
not a plaintext match for the email — a smaller, safer change, but a new
test file convention, not a one-line fix. Both are a deliberate choice about
this test suite's fixture conventions, not a code defect, so left to a
product/maintainer decision rather than guessed at here. Not mirrored to
`docs/KNOWN_LIMITATIONS.md` (it is a test-suite gap, not an operator-facing
limitation).

### LOC10-3 — INFO — the new confirm-token/lookup oracle is a deliberate, compensated tradeoff, not a defect — verified good, residual risk named

**What:** `guest_lookup` answers one of three distinguishable outcomes for
any email a caller submits: `prospect` (with a confirm token and a first
name + last initial), `member` (account exists, no further detail), or
`not_found`. Someone holding a room's display code and a valid event id —
both needed already, since `_resolve_guest_event` 404s otherwise — could
script this to learn whether a specific email address is an active applicant
or a department member.
**Where:** `app/api/public/display.py:615` (`guest_lookup`); the tradeoff is
named directly in the code's own comment at `_rate_limit_guest_lookup`
(`display.py:113-117`): "The lookup answers 'is this email an applicant (or
a member) here', which is exactly what someone holding a room's link would
script against."
**Compensating controls, all present and verified:** a 10/minute per-IP rate
limit with a 10-minute lockout on breach; a separate per-event daily ceiling
distinct from the attendance cap; every outcome logged (by outcome and id,
never the email) so a run of misses from one address is visible after the
fact; a uniform 200 response and response shape across all three outcomes
(no status-code or schema difference an automated prober could key on
faster than the rate limit allows); the honeypot catching naive scripted
submissions before either gate.
**Impact:** a slow, rate-limited, audited oracle remains an oracle. It is not
a new finding beyond what the code's own comment already discloses and
accepts — recorded here so the tradeoff is visible in this feature's own
findings history, not only in a comment a future diff could delete without
anyone noticing the review already weighed it.
**Fix:** none proposed. Removing the distinction would mean telling an
active applicant "see staff" indistinguishably from an unrecognized visitor,
which defeats the feature's purpose. Not mirrored to
`docs/KNOWN_LIMITATIONS.md` — it is a bounded, monitored design choice, not
an open operator decision.

### LOC10-4 — LOW — cross-feature, pre-existing, not fixed here: a duplicate-applicant log line still carries the raw email

**What:** `MembershipPipelineService.create_prospect`'s duplicate-detection
branch logs `logger.info(f"Duplicate prospect detected for email {email} in
org {organization_id} — returning existing prospect {existing.id}")` — the
raw applicant email, by f-string, into the application log.
**Where:** `app/services/membership_pipeline_service.py:1813-1817`.
**Not in this feature's scope:** `create_prospect` is not reachable from the
kiosk's `guest_lookup`/`guest-confirm` pair, which call
`find_active_prospect_by_email` → `_find_active_prospect_by_email(current_read=False)`
directly and never touch `create_prospect`'s duplicate-notification path.
`create_prospect` belongs to Membership pipeline / Volunteer recruitment's
own staff-facing application-submission surface. `43c11090` (which did
remove the OAuth-login and onboarding audit entries' email copies, by its
own commit message) did not touch this line, so it is a live, pre-existing
gap, just outside this pass's files.
**Impact:** application log carries PII for a surface outside this
feature's review scope.
**Fix:** not applied — out of this feature's declared files, flagged for
Membership pipeline / Volunteer recruitment's own next pass, matching the
precedent LOC9 and CRON10 both set for a cross-feature finding found while
reading a shared dependency (NFC admin surface, email kill-switch,
respectively).

## Schema & migration notes

- Alembic head is single (confirmed via `validate_migrations.py --strict`:
  666 revisions, head `0d9897752425` — see gate below). No migration in
  `5d38437a..HEAD` touches a table this feature's models declare or a column
  with a FK to `locations.id`.
- `ondelete="SET NULL"` columns pointing at `locations.id` remain
  `nullable=True` on every one (Pitfall #2): re-derived the full FK set
  directly from `Base.metadata` (not trusted from either prior pass's
  count) — 5 `RESTRICT` (`events.location_id`, `event_templates.default_location_id`,
  `apparatus.primary_station_id`, `apparatus.current_location_id`,
  `apparatus_location_history.location_id`) and 9 `SET NULL`
  (`event_requests`, `nfc_card_taps`, `inventory_items`, `storage_areas`,
  `meetings`, `training_records`, `course_classes`, `course_cohorts`,
  `course_cohort_classes`), unchanged from pass 9.

### LOC8-2 — LOW — hard-deleting a location nulls its location on nine kinds of records — 🚩 still FLAGGED (owner decision, unchanged disposition)

**What/Where/Impact:** unchanged from pass 9 — see
`LOC9-32-locations-kiosk.md`. Count re-confirmed at 9 (above), no new table
added since pass 9. `docs/KNOWN_LIMITATIONS.md`'s entry already reflects the
count of 9; no edit needed there this pass.

## Guard tests added

None. No new invariant needed a guard test this pass: LOC10-1's defect was
already fixed and already covered by `test_guest_email_first_sign_in.py`'s
`TestConfirmToken`/`TestLookup`/`TestConfirm` classes for every scenario
_except_ the ciphertext-comparison one (LOC10-2, flagged rather than fixed,
since closing it is a test-fixture-convention decision, not a one-line
guard).

## Completion gate

| Check                                                                                                                                                     | Result                                                     |
| --------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `flake8 app/ tests/ alembic/` (7.4.1, CI-pinned)                                                                                                          | ✅ 0 violations                                            |
| `black --check app/ tests/ alembic/` (26.10.1, CI-pinned)                                                                                                 | ✅ clean, 2706 files unchanged                             |
| `isort --check-only app/ tests/ alembic/` (9.0.2, CI-pinned)                                                                                              | ✅ clean                                                   |
| `python3 scripts/validate_migrations.py --strict`                                                                                                         | ✅ PASSED, 666 revisions, single head `0d9897752425`       |
| Route re-enumeration (AST walk of all 3 files' decorators)                                                                                                | ✅ 17/17, +2 from pass 9, both accounted for               |
| `pytest tests/test_location_restrict_references.py`                                                                                                       | ✅ 3 passed                                                |
| `pytest tests/test_guest_email_first_sign_in.py`                                                                                                          | ✅ 33 passed                                               |
| Scoped `pytest -k "location or admin_hub or display or facilit or restrict_references or live_schema_drift or account_status_gates or guest_email_first"` | ✅ 938 passed, 1 skipped (optional `pywebpush`, unrelated) |
| `npm run typecheck`                                                                                                                                       | ✅ 0 errors                                                |
| `npm run lint`                                                                                                                                            | ✅ 0 errors, 0 warnings                                    |
