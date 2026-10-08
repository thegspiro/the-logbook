# Security Review — Feature 30: Onboarding (pass 6)

**Prefix:** `ONB4` · **Rotation pass:** 6 (prior: module-audit iteration 25,
app-review B25 (4 passes), security-review pass 1 — PR #1913 + follow-up
(`docs/security-review/ONB2-30-onboarding.md`), pass 2 — PR #2093
(`docs/security-review/ONB-30-onboarding.md`), passes 3–5 — PRs #2358, #2521,
#2898 (`docs/security-review/ONB3-30-onboarding.md`)) · **Reviewed:**
2026-10-08

**Backend:** `backend/app/api/v1/onboarding.py` (2,913 L, 24 unauthenticated
bootstrap routes), `backend/app/services/onboarding.py` (1,732 L),
`backend/app/models/onboarding.py`, `backend/app/utils/onboarding_security.py`,
`backend/app/api/v1/email_test_helper.py`, `backend/app/utils/email_providers.py`,
`backend/app/utils/microsoft_oauth.py`, `backend/app/services/template_service.py`,
`backend/app/services/org_template_service.py`,
`backend/app/services/org_template_registry.py`.
**Frontend:** `frontend/src/modules/onboarding/` (swept, not read line-by-line
— see Scope), `frontend/src/pages/LoginPage.tsx` (read in full — see Scope).
**Migrations:** none this pass; `onboarding_status`/`onboarding_sessions` are
unchanged real migrations (`20260201_0018_create_onboarding_tables.py` +
`ONBOARD-7`'s singleton migration), both already covered by prior passes.

---

## Scope

Pass 5's baseline is PR #2898's merge commit `82f06f4c`. This pass:

1. Read `CHECKLIST.md`, `SEC-00-cross-cutting-baseline.md`,
   `docs/KNOWN_LIMITATIONS.md`'s onboarding rows, and all three prior
   findings files (`ONB-30-onboarding.md`, `ONB2-30-onboarding.md`,
   `ONB3-30-onboarding.md`, the latter covering passes 3–5) in full before
   reading any code. Every item either file still marks open or flagged is
   re-verified below against current code, not re-derived.
2. `git diff --stat 82f06f4c..HEAD`, scoped to this feature's file list.
   **No diff** in `models/onboarding.py`, `utils/onboarding_security.py`,
   `template_service.py`, `org_template_service.py`,
   `org_template_registry.py`, `email_test_helper.py`, `microsoft_oauth.py`,
   `email_providers.py` — confirmed byte-identical (`git diff --quiet`), so
   every finding scoped to them carries pass 5's verification forward
   unchanged. Diff in this feature's own files: `onboarding.py` (+62/-22),
   `services/onboarding.py` (a docstring correction only, +6/-5).
3. **Read `onboarding.py` in full, end to end** (not just the diff) —
   2,913 lines, all 24 routes re-enumerated directly from source (see Route
   inventory). **Read `services/onboarding.py` in full, end to end**
   (1,732 lines before this pass's fix) — every method, not sampled, because
   the single prior finding of this severity class (ONB3-30-3) was found by a
   full read of exactly this file, not a diff. `models/onboarding.py` and
   `utils/onboarding_security.py` read in full (small enough, and schema
   integrity is checklist dimension 7).
4. **Frontend:** read `frontend/src/pages/LoginPage.tsx` in full (it changed
   since pass 5 — new Authentik SSO button — and is the call site of the
   unauthenticated `GET /status` route this feature owns, so a change to how
   it calls that route is in scope even though the file itself lives outside
   `modules/onboarding/`). The rest of `modules/onboarding/` was swept, not
   read line-by-line, for the four risk classes passes 3–5 established
   (`window.confirm`/`alert`/`prompt`, `dangerouslySetInnerHTML`, secrets
   written to `localStorage`/`sessionStorage`, a raised/removed client-side
   cap with no independent server-side cap) — **0 hits**, same as every
   prior pass. The two substantive diffs in that tree
   (`AuthenticationChoice.tsx`, `EmailConfiguration.tsx`) are copy/color
   changes only (read in full; see Verified good).

## Route inventory (re-enumerated, 24/24)

Re-walked every `@router.get`/`@router.post` decorator in current
`onboarding.py` directly from source, not carried forward from pass 5's
table without re-checking:

| Method | Path                    | Auth dependency                        | Compensating control                                                                                               | Unchanged since         |
| ------ | ----------------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ----------------------- |
| GET    | `/status`               | none                                   | rate-limited (`_rate_limit_onboarding_status`, read-appropriate 60/60s budget); minimal post-completion response   | pass 2                  |
| POST   | `/start`                | none                                   | rate-limited; `_require_owner_authority` once an owner exists                                                      | pass 4                  |
| GET    | `/system-info`          | `validate_session(require_csrf=False)` | rate-limited                                                                                                       | pass 2                  |
| GET    | `/security-check`       | `validate_session(require_csrf=False)` | rate-limited                                                                                                       | pass 2                  |
| GET    | `/database-check`       | `validate_session(require_csrf=False)` | rate-limited; generic error                                                                                        | pass 2                  |
| POST   | `/organization`         | `validate_session` (CSRF required)     | `needs_onboarding()`; single-org guard — **now a locking read, ONB4-30-1**                                         | **this pass (locking)** |
| POST   | `/system-owner`         | `validate_session`                     | rate-limited; `needs_onboarding()`; single-owner guard, locked (ONB3-30-3)                                         | pass 4                  |
| POST   | `/modules`              | `validate_session`                     | `needs_onboarding()`                                                                                               | pass 2                  |
| POST   | `/notifications`        | `validate_session`                     | `needs_onboarding()`                                                                                               | pass 2                  |
| POST   | `/complete`             | `validate_session`                     | `needs_onboarding()`; one-way latch; email-completeness pre-flight                                                 | pass 3                  |
| POST   | `/test/email`           | `validate_session`                     | rate-limited; self-hosted SMTP SSRF gap open (ONB-30-3)                                                            | pass 2                  |
| POST   | `/session/department`   | `validate_session`                     | `needs_onboarding()`                                                                                               | pass 2                  |
| POST   | `/session/email`        | `validate_session`                     | `needs_onboarding()`; encrypted at rest; completeness pre-flight                                                   | pass 3                  |
| POST   | `/session/file-storage` | `validate_session`                     | `needs_onboarding()`; encrypted at rest                                                                            | pass 1                  |
| POST   | `/session/auth`         | `validate_session`                     | `needs_onboarding()`                                                                                               | pass 1                  |
| POST   | `/session/it-team`      | `validate_session`                     | `needs_onboarding()`; capped 50                                                                                    | pass 1                  |
| POST   | `/session/stations`     | `validate_session`                     | `needs_onboarding()`; capped 50                                                                                    | pass 2                  |
| POST   | `/session/apparatus`    | `validate_session`                     | `needs_onboarding()`; capped 100                                                                                   | pass 2                  |
| POST   | `/session/modules`      | `validate_session`                     | `needs_onboarding()`; module allowlist                                                                             | pass 1                  |
| POST   | `/session/organization` | `validate_session`                     | `needs_onboarding()`; single-org guard — **same locking fix, ONB4-30-1**                                           | **this pass (locking)** |
| POST   | `/session/roles`        | `validate_session`                     | `needs_onboarding()`; outer cap 200, per-role `permissions` cap 50; ONB-7 open                                     | pass 3                  |
| POST   | `/session/positions`    | delegates to `/session/roles`          | inherits all guards                                                                                                | pass 1                  |
| GET    | `/session/data`         | `validate_session` (CSRF required)     | allowlisted fields only                                                                                            | pass 1                  |
| POST   | `/reset`                | `validate_session`                     | rate-limited; `_require_owner_authority`; audit log — **now written durably before any delete, see Verified good** | pass 5                  |

24/24 accounted for — matches SEC-00's baseline count and every prior pass's
table. No route lost a compensating control.

**Correction to pass 5's table:** pass 5 listed `POST /organization`'s auth
dependency as "none (session not yet mintable; single-org guard)". That is
wrong against current code (and was already wrong against the code pass 5
itself reviewed — `git diff --quiet` confirms this route's `await
validate_session(request, db)` call predates pass 5). Pass 3's own table had
it right (`validate_session` (CSRF required)). This looks like a transcription
slip in pass 5's table rather than a behavior change, since pass 5 reported no
diff touching this route and its own "Verified good" section never claimed the
route was unauthenticated. No code or security consequence — `/organization`
has required a valid, CSRF-bearing session since at least pass 2 — but
recorded here since the task asks this pass to re-verify prior claims against
current code rather than carry them forward unread.

## Verified good ✅ (re-confirmed this pass, mechanism re-checked against current code)

- **ONB-1 through ONB-6, ONB-9, ONB2-30-1 through ONB2-30-8, ONB3-30-1,
  ONB3-30-2, ONB3-30-3** — all re-confirmed present and unregressed, by direct
  read of `onboarding.py` end to end and of every byte-identical file (see
  Scope §2).
- **ONB-8's reset re-authentication, `/status` minimal post-completion
  response, and template mass-assignment guards** — unchanged, confirmed by
  direct read (`onboarding.py:2800-2804` for `_require_owner_authority` in
  `/reset`; `:1115-1127` for `/status`; `template_service.py` byte-identical).
- **The ONB-8 audit-durability residual, open since pass 2, is now fixed —
  landed independently of this rotation, not by this pass.** Every prior
  pass flagged that `onboarding.reset_initiated` was logged in the same
  transaction as `/reset`'s deletes, so a failed reset rolled its own audit
  trail back along with the data it never deleted. Current code
  (`onboarding.py:2745-2823`) now writes `reset_initiated` through a new
  `_audit_reset_durably` helper that opens its own `async_session_factory()`
  session and commits it **before** any delete runs, and refuses the reset
  outright (500, nothing deleted) if that durable write itself fails; a
  `reset_failed` event is attempted the same durable way inside the
  `except Exception` branch if deletion itself fails. This closes the
  residual cleanly: a reset attempt is now recorded whether or not the reset
  that follows it succeeds. Nothing in `KNOWN_LIMITATIONS.md` named this
  residual as its own row (it was tracked only inside the findings-file
  prose), so there is no row to update there.
- **`AuthenticationChoice.tsx` / `EmailConfiguration.tsx` diffs since pass
  5** — copy clarification (naming the `AUTHENTIK_*` env vars and the signing
  key requirement) and a button color change (blue-600 → red-800, the AAA
  primary-fill palette CLAUDE.md documents) respectively. Neither touches
  validation, submission, or stored data. **Verified good.**
- **`LoginPage.tsx`'s new Authentik SSO button and OAuth error messages** —
  read in full. `oauthConfig.authentikEnabled` gates the button the same way
  `googleEnabled`/`microsoftEnabled` already do; `handleAuthentikLogin`
  redirects to `authService.getAuthentikOAuthUrl()`, a same-shape sibling of
  the existing Google/Microsoft redirect functions. The error-message map
  gained `provider_unavailable`/`provider_misconfigured` and genericized
  provider-specific wording (`no_email`, `account_conflict`,
  `unverified_email`) to cover a third provider — no new information
  disclosed, same codes-not-strings pattern the file's own comment already
  called out. This is outside this feature's own file list (SSO provider
  config lives elsewhere), checked only because it is a call site of this
  feature's unauthenticated `GET /status`/OAuth-callback surface; it does not
  change how `/status` is called. **Verified good, no finding.**
- **No LIKE/ILIKE, no CSV export, no new JSON-column nested mutation** in
  this pass's diff — `_audit_reset_durably`'s `event_data` dict is built fresh
  per call, not mutated from a read; `create_organization`'s new lock reads
  add no JSON-column writes at all. N/A / no violation.

## Findings

### ONB4-30-1 — HIGH — `create_organization`'s single-org guard was an unlocked read-then-write; two concurrent callers both created an organization — ✅ FIXED

**What:** `OnboardingService.create_organization` (the handler behind both
`POST /organization` and `POST /session/organization`) refused a second
organization by reading "does any organization exist" with a plain,
non-locking `SELECT` and then inserting one — the identical shape ONB3-30-3
found and fixed one call below in `create_system_owner`, and the shape
ONBOARD-7 fixed for `onboarding_status` itself (CLAUDE.md pitfall #27: "a
capacity check is a read-then-write and needs the row locked"). Despite
sharing both the bug class and the call chain with ONB3-30-3, no prior pass's
"Verified good" section checked this guard specifically — each treated ONB-2
("single-org guard... in `create_organization`") as a correctness check
already covered and moved on to the sibling owner guard.

**Where:** `backend/app/services/onboarding.py`, `create_organization` (the
guard sat at what is now line ~630: `any_org = await self.db.execute(select(
Organization.id).limit(1))`).

**Why this is reachable pre-auth, same window as ONB3-30-3:** both routes that
call this method require only `validate_session` — a valid onboarding session
and (for `/organization`) a CSRF token from that same session, nothing tying
the session to a particular caller. Minting a session via `POST /start` is
unauthenticated by design before any organization exists
(`get_or_create_session`'s own docstring: "guard on completion, never on the
mere existence of an organization"). So two independent callers — an attacker
and the real operator, or the real operator's own double-submitted tab —
reaching `/organization` within milliseconds of each other is a real,
pre-authentication window on a network-reachable, freshly-deployed instance,
not a hypothetical one.

**Failure scenario, reproduced against a real database (not mocked), 8/8
runs:** two independent `AsyncSession`s, each on its own connection, both call
`create_organization` with distinct names/slugs within milliseconds
(`asyncio.gather`). Before the fix: **both succeeded** — 2 rows in
`organizations`. This is worse than a merely wasted row:
`create_system_owner`'s own organization lookup
(`onboarding.py`'s `/system-owner` handler) is "first **active** org, ordered
by `created_at` ascending" — not the row the caller's own session created. If
the attacker's organization happens to sort first, the real operator's own
`/system-owner` submission creates their account as a member of the
**attacker's** organization while the organization they actually described
sits as an orphaned second row with no owner and no path to one (every
onboarding route that resolves "the" organization uses the same
first-active-by-created-at lookup). `_seed_default_data` (run at
`/complete`) has the same "first org, first user with no tiebreak" shape and
would seed admin-hours categories against whichever org and user happened to
sort first, independent of which one actually finished the wizard.

**Impact:** HIGH. An attacker who wins this race does not need to win the
System Owner race too (ONB3-30-3) — merely creating the organization first is
enough to redirect the legitimate operator's own subsequent, fully-correct
System Owner submission onto the attacker's organization, at which point the
attacker's own `/system-owner` call (now running against an org they already
control) succeeds normally and they hold full administrative access to what
the real department's data ends up filed under.

**Fix:** mirrors ONB3-30-3's remediation exactly. Locks the `onboarding_status`
singleton row (`select(OnboardingStatus).with_for_update()`) before the
existence check — the parent to lock, per pitfall #27, since there is no
`Organization` row to lock until one caller has already won, and
`onboarding_status` is guaranteed to exist by the time this method is
reachable at all (the session required to call it is only mintable after
`/start` has already created that row via `start_onboarding`). The existence
check itself is now also a locking read
(`select(Organization.id).limit(1).with_for_update()`), not merely guarded by
the parent lock — under InnoDB's default REPEATABLE READ, a loser that already
took its own snapshot earlier in the same request would still see zero
organizations after being released from the lock, and would create a second
one anyway. Both halves were necessary (the same gotcha pitfall #27 and
ONB3-30-3 both document).

**Verification:** the reproduction script (2 real, independently-committing
connections, `asyncio.gather`) was re-run 8 times against the fixed code:
**8/8 → exactly 1 success, 1 row in `organizations`**, after reliably
reproducing 2/2 successes every run before the fix. A permanent regression
test, `backend/tests/test_onboarding_organization_race.py`, reproduces the
same shape using the established two-connection pattern from
`test_onboarding_owner_race.py` (`@pytest.mark.integration`, real
`database_manager.engine.connect()` per coroutine) plus two source-level
guards mirroring `TestTheLockIsDeclared`. Verified to **fail** (2 successes,
not 1; both source guards fail too) with the fix reverted (`git stash`), and
to **pass** restored.

**Guard test added:** `tests/test_onboarding_organization_race.py` —
`TestConcurrentOrganizationCreation::
test_two_concurrent_callers_produce_exactly_one_organization` (integration,
real MySQL, 2 connections) plus `TestTheLockIsDeclared`'s two source-level
assertions (the parent-row lock and the locking-read existence check are each
present in `create_organization`'s source).

## Re-verification of prior findings (all hold, no regressions, except where noted above)

- **ONB-7** — `save_session_roles` still accepts client-supplied
  `permissions` (unrestricted module-id keys), `priority`, and `is_custom`
  (which sets `is_system`) on a new role/position. Re-confirmed by direct
  read of the current function (`onboarding.py:2441-2666`), byte-identical in
  the relevant shape to pass 5. Still a product-policy call, not a drive-by
  fix. `KNOWN_LIMITATIONS.md` entry unchanged.
- **ONB2-30-8** — session TTL is a sliding 30-minute window with no absolute
  cap; `/system-info`, `/security-check`, `/database-check` slide it on the
  session id alone (`require_csrf=False`, confirmed at
  `onboarding.py:1221-1294`). `validate_session`'s unconditional renewal
  confirmed at `:878-882`. Re-confirmed OPEN, unchanged. Policy call (what
  the cap should be, whether routine wizard navigation could ever hit it).
- **ONB-30-3** — `/test/email`'s self-hosted SMTP path
  (`email_test_helper.py`, confirmed byte-identical since pass 3) still
  connects to a fully client-supplied `smtpHost`/`smtpPort` via raw
  `smtplib` with no hostname/IP validation. Re-confirmed OPEN, unchanged, for
  the same reason every prior pass left it: blocking private IPs would break
  the legitimate on-premises-relay deployment pattern this app's audience
  uses.
- **Duplicate `role.id` within one `/session/roles` payload still raises an
  unhandled `IntegrityError` → 500** — re-confirmed OPEN. No dedup logic
  anywhere in current `save_session_roles` (grepped `seen`/`duplicate`/
  `dedup` — no matches). Pre-existing, larger fix than a cap.
- **`POST /organization` missing the `except Exception` its twin
  `/session/organization` has** — re-confirmed OPEN, unchanged
  (`onboarding.py:1403-1406`: only `except ValueError`). Cosmetic robustness
  gap, not a security issue — `safe_error_detail`/production `DEBUG=false`
  still govern whatever FastAPI's default handler does with an uncaught
  exception, and this pass's `create_organization` fix does not raise a new
  exception type on the happy or lock-contended path (a lost race still
  raises the same `ValueError` the unlocked version raised, just atomically
  now).
- **`ITTeamMemberRequest.email` is `str`, not `EmailStr`** — re-confirmed
  unchanged (`onboarding.py:469-475`), intentionally loose to match
  `create_it_team_users`'s skip-if-invalid behavior.

## Schema & migration notes

No new model, column, or migration this pass — the fix is a query-locking
change inside an existing method, not a schema change. `onboarding_status`
and `onboarding_sessions` are unchanged since pass 2 (confirmed via the
byte-identical-file check, `models/onboarding.py`). `validate_migrations.py
--strict`: 543 revisions, single head `7db20aa49329`, clean.

## Guard tests added

- `tests/test_onboarding_organization_race.py` — `TestTheLockIsDeclared`
  (two source-level assertions: the `onboarding_status` lock and the
  `Organization.id` locking-read existence check are both present in
  `create_organization`'s source) and
  `TestConcurrentOrganizationCreation::
test_two_concurrent_callers_produce_exactly_one_organization` (integration,
  real MySQL, two independently-committing connections via
  `asyncio.gather`). All three verified to fail against the pre-fix code and
  pass against the fixed code.

## Completion gate

| Check                                                                                                                                                                   | Result                                                                                                                                                                             |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `python3.13 -m flake8 app/ tests/ alembic/` (bare `flake8` on this sandbox's `PATH` omits `flake8-pytest-style`; CI matches `python3.13 -m flake8` — see pass 4's note) | ✅ 0 violations                                                                                                                                                                    |
| `python3.13 -m black --check app/ tests/ alembic/`                                                                                                                      | ✅ clean (after formatting the new test file; 2,043 files unchanged)                                                                                                               |
| `python3.13 -m isort --check-only app/ tests/ alembic/` (9.0.1, CI-pinned)                                                                                              | ✅ clean                                                                                                                                                                           |
| `python3.13 scripts/validate_migrations.py --strict`                                                                                                                    | ✅ 543 revisions, single head `7db20aa49329`                                                                                                                                       |
| `pytest tests/ -q -k "onboard or org_template or template_service"`                                                                                                     | ✅ 262 passed, 1 skipped (pywebpush, env-only) — up from pass 5's 255 (new: 3 tests in `test_onboarding_organization_race.py`)                                                     |
| `pytest tests/test_onboarding_organization_race.py -v`                                                                                                                  | ✅ 3 passed                                                                                                                                                                        |
| Guard-test reintroduction check (fix reverted via `git stash`)                                                                                                          | ✅ fails as expected (2/2 organization-creation successes, not 1; both source-level guards fail) with the fix removed; passes restored                                             |
| `pytest tests/` (full suite)                                                                                                                                            | ✅ 17,384 passed, 21 skipped (all pre-existing, environment-only: optional `pywebpush`, opt-in API-contract suite, Docker daemon/registry unavailable in this sandbox), 0 failures |
| `npm run typecheck` (frontend, aliased 7.0.2 compiler, `tsc-native.mjs`)                                                                                                | ✅ 0 errors                                                                                                                                                                        |
| `npm run lint` (frontend, `--max-warnings 10`)                                                                                                                          | ✅ 0 errors, 0 warnings                                                                                                                                                            |
