# Security Review — Auth & Session Lifecycle

**Prefix:** `AUTH` · **Iteration:** 01 · **Reviewed:** 2026-08-25 (pass 1), 2026-08-27 (pass 2), 2026-09-01 (pass 3) · **PR:** #1804 (pass 1), #1929 (pass 2), #2133 (pass 3)

---

## Pass 3 (2026-09-01)

**Diff since pass 2's baseline (`9a58e352`):** `auth.py` (+11/-4),
`consent_service.py` (+104/-4, all `roster()` — already reviewed and fixed in
pass 2, unchanged since), `models/user.py` (+124, all member-classification
work unrelated to auth — see the file's own `_reconcile_membership` docstring;
out of this feature's scope). `mfa_service.py` and `oauth_service.py` are
byte-identical to pass 2. Three frontend files touched since pass 2
(`authStore.ts`, `apiClient.ts`, `utils/createApiClient.ts`) — all three
diffs are already-landed fixes from other work (a `decodeURIComponent` on the
CSRF cookie reader, adding `/auth/mfa/login` to the refresh-skip allowlist so
an invalid MFA code doesn't trigger a refresh attempt, and a JSON-blob-decode
fix for file-download error responses); read and confirmed correct, not new
findings.

**Re-verified both prior fixes and the one flagged item, all still current:**

- **AUTH-1** (OAuth login skipped the organization-active check) — the fix is
  still in place: `oauth_service.py:50-60`'s `_link_existing_user` still
  filters `Organization.active.is_(True)` and fails closed with
  `(None, "no_account")` on an empty result. `test_resolve_user_no_active_organization`
  still passes.
- **AUTH-3** (stale photo-consent roster response could overwrite a newer one)
  — the `cancelled` guard is still present in
  `PhotoUseConsentPage.tsx:68-84`.
- **AUTH-4** (unbounded roster query, informational) — still accurate;
  `ConsentService.roster()` remains unpaginated for the same reason recorded
  in pass 2 (one of 255+ identically-shaped call sites app-wide; not a
  meaningful fix in isolation).

**Full re-read of all four in-scope backend files** (`auth.py` 1543 L / 26
routes — route count unchanged from pass 1, the +11 lines are one new import
and one line in `_build_current_user_dict` expanding legacy permission
aliases into the `/auth/me` and login-response permission list, unrelated to
this feature's own security surface and already correctly implemented in
`app/core/permissions.py`; `auth_service.py` 978 L; `mfa_service.py` 121 L;
`oauth_service.py` 340 L) against all seven checklist dimensions.

### Correction (Codex review on PR #2133)

Pass 3's original "Verified good" section (below, as first published) was
wrong on both of its two claims. Codex caught both; re-verified against the
real code before acting on either, per this rotation's own rule that a wrong
fix in an auth path is worse than an honest finding.

> ~~**TOTP replay handling is intentionally asymmetric between login and
> already-authenticated MFA management, and the asymmetry is not a gap.**~~
> ~~... none of the three management routes let a replay do anything a single
> legitimate call could not already do.~~
>
> ~~**`security_monitor.detect_brute_force`/suspicious-IP wiring from the auth
> endpoints matches `SEC-00`'s documented brute-force model exactly** ...~~

Struck through rather than deleted, so the record shows what was actually
claimed and reviewed, not a cleaned-up version of it.

### AUTH-7 — P1 — A TOTP code verified at an MFA management route was never recorded as consumed, letting it replay at `/mfa/login` — ✅ FIXED

**What:** `mfa_login` verifies a live TOTP code through
`verify_totp_get_timestep(secret, code, last_timestep=user.mfa_last_timestep)`
and, on success, records the matched step in `user.mfa_last_timestep` — a
code whose step is `<=` that value is rejected as a replay
(`mfa_service.py:42-75`). `mfa_verify_setup`, `mfa_disable`, and
`mfa_regenerate_recovery_codes` (the `/mfa/recovery-codes` handler) instead
called bare `mfa_service.verify_totp(secret, code)`, which returns a
boolean and touches no state at all. None of the three ever wrote
`mfa_last_timestep`.

The original "Verified good" writeup reasoned that this was harmless because
all three routes require an authenticated session and are each
self-blocking against a _second call to that same route_ with the same code
(`mfa_verify_setup`/`mfa_disable` flip `mfa_enabled` so a repeat hits the
router's own 400 first; regenerating recovery codes twice was called
"idempotent-equivalent in risk"). That reasoning only checked replay _at the
same endpoint_. It never checked replay _at a different endpoint_ — and
`/mfa/login` is exactly that: a route that accepts a bare TOTP `code` from
anyone holding a fresh `mfa_pending` token, with no session of its own.

**Where:** `app/api/v1/endpoints/auth.py` — `mfa_verify_setup` (former line
940), `mfa_disable` (former line 989), `mfa_regenerate_recovery_codes`
(former line 1050); all three called `mfa_service.verify_totp` directly,
pre-fix.

**Failure scenario:** an attacker already holds the account's password (a
breach, reuse, phishing — a prerequisite either way, and the same
prerequisite the "Attack Protection" table in CLAUDE.md already assumes for
every MFA-bypass discussion). That alone gets them a valid `mfa_pending`
token for free from `POST /login` — the password step succeeds regardless
of MFA. If the attacker then _observes_ a TOTP code the legitimate user is
using _right now_ at `/mfa/recovery-codes` (or `/mfa/disable`, or
`/mfa/verify-setup` during enrollment) — shoulder-surfing, a compromised
endpoint or extension, a phishing-relay page that captures and immediately
forwards the code — nothing recorded that time-step as spent. The attacker
submits the same code to `/mfa/login` within its remaining ~30–60s validity
window (pyotp's default `valid_window=1` both `verify_totp` and
`verify_totp_get_timestep` use accepts the step before and after "now," so
the practical window is up to ~90s from when the legitimate user's code was
generated) and completes a fully independent login of their own — a second,
attacker-controlled session, indistinguishable from the legitimate one at
the protocol level. `user.mfa_last_timestep` was `None` or older than the
current step regardless of how many times the code had already been used
elsewhere, so `mfa_login`'s replay check had nothing to reject.

Confirmed empirically, not just reasoned: reverting the fix and driving
`mfa_regenerate_recovery_codes` then `mfa_login` with the same code through
the real handlers produces a completed session
(`Created session for user: ...`, `mfa_login` returns 200) — see the
`git log` message on this fix's commit for the reproduction. The design gap
predates this pass (`mfa_last_timestep`'s own column comment says "Highest
TOTP time-step ... already accepted **at login**" — the mechanism was scoped
to the login path from when it was written, not extended when the three
management routes were added), so this is not a regression introduced by
pass 3's diff; pass 3's error was mischaracterizing it as verified-safe.

**Fix:** introduced `_verify_and_consume_totp(user, code) -> bool` in
`auth.py` — the single "verify AND consume" primitive every code-verifying
route must go through. It calls `verify_totp_get_timestep` and, on a match,
sets `user.mfa_last_timestep` before returning `True`. All four call sites
(`mfa_login`, `mfa_verify_setup`, `mfa_disable`,
`mfa_regenerate_recovery_codes`) now call it instead of calling
`verify_totp`/`verify_totp_get_timestep` directly; each route's existing
`db.commit()` persists the recorded step exactly as it already persisted
every other field the route sets in the same request. No behavior change to
any route's success/failure semantics — only that a verified code is now
always recorded as spent, everywhere.

**Also raised (Codex): `/mfa/recovery-codes` is not idempotent** — a retried
request (network retry, double-click) regenerates an entirely new code set
and overwrites the stored hashes, so a client that never saw the first
response is left with codes that don't match what was displayed. **FLAGGED,
not fixed** — see `docs/KNOWN_LIMITATIONS.md`. This fix incidentally
narrows it (a retry using the _same_ TOTP code now fails cleanly with
"Invalid verification code" instead of silently generating a second set,
because the code was already consumed by the first call), but does not
close it: a retry that lands after the server committed but the response
was lost in transit still leaves the user without the codes they were
shown. That is a generic exactly-once-delivery problem shared by every
secret-shown-once response in this file (`mfa_verify_setup`'s recovery codes
have the identical exposure), not specific to TOTP replay, and the right
fix (an idempotency-key mechanism, or a "re-show last-issued codes" path) is
a product decision this pass is not making unilaterally in an auth path.

**Guard test:** `TestTotpConsumedAcrossMfaRoutes` in
`backend/tests/test_auth_mfa_endpoints.py` —
`test_code_used_at_recovery_codes_route_cannot_replay_at_login` drives the
real `mfa_regenerate_recovery_codes` handler with a valid code, then submits
the same code to the real `mfa_login` handler and asserts a 401. Confirmed
to fail pre-fix: reverting `auth.py` to the pre-fix revision and re-running
the exact same two calls (via a standalone script, since the pre-fix module
doesn't even export `_verify_and_consume_totp`) shows `mfa_login` completing
successfully with the replayed code — `user.mfa_last_timestep` stayed `None`
after the recovery-codes call, and `mfa_login` proceeded straight to session
creation. Two supporting unit tests
(`test_verify_and_consume_totp_rejects_its_own_replay`,
`test_fresh_code_after_consumption_still_verifies`) cover the shared
primitive directly.

### AUTH-8 — P2 — `mfa_login` never fed `detect_brute_force`, and the doc's "matches SEC-00's model" claim was wrong — ✅ FIXED

**What:** `login`'s password-failure branch calls
`security_monitor.detect_brute_force(db, ip=login_ip, user_id=None,
success=False)` and its password-success branch calls it again with
`success=True` — but that success call runs _before_ the `if
user.mfa_enabled:` branch (`auth.py`, former lines 682–727), i.e. on
password-correct alone, not on full authentication. `mfa_login` — the
second-factor completion step — never called `detect_brute_force` at all,
in either its failure or success path. The original writeup asserted this
"matches `SEC-00`'s documented brute-force model exactly" and specifically
that `clear_auth_failures` (a _different_ function, the suspicious-IP
throttle) is "called only after full authentication succeeds — after the
MFA branch on `login`, not on password-correct alone." That description of
`clear_auth_failures` is correct — but the claim was about
`detect_brute_force`'s wiring being equivalent, and `detect_brute_force`'s
own success call sits _before_ the MFA branch, the opposite of the
invariant being cited to justify it. And `mfa_login` calling it not at all
means guessing the second factor generates zero `detect_brute_force`
alerting history for the whole MFA step.

**Where:** `app/api/v1/endpoints/auth.py` — `login`'s
`detect_brute_force(..., success=True)` call at former line 713 (still
runs, and is correctly positioned relative to _its own_ purpose — see
"What's still covered" below); `mfa_login` had no `detect_brute_force` call
anywhere, pre-fix.

**What's still covered, so the write-up is precise about scope:**
`detect_brute_force` is purely an alerting/audit mechanism — it stages a
HIGH-severity `SecurityAlert` row and an audit-log entry past a threshold; it
enforces nothing itself. Two _enforcing_ controls already covered MFA-code
guessing before this fix and still do: the per-account lockout
(`user.failed_login_attempts`/`locked_until`, mirroring the password step's
own lockout logic) and the suspicious-IP throttle
(`record_auth_failure`/`clear_auth_failures`, gated on the next request by
`enforce_suspicious_ip`). Guessing the second factor was already throttled
and eventually locked the account; what was missing was purely this one
detector's alert firing and its short-window per-IP/per-user tally.

**Fix:** `mfa_login`'s failure branch now calls
`security_monitor.detect_brute_force(db, ip=get_client_ip(request),
user_id=str(user.id), success=False)` alongside the existing
`failed_login_attempts` increment, before the branch's existing
`db.commit()` (which now also persists any alert row `detect_brute_force`
staged — no new commit needed). The success branch calls it with
`success=True` alongside the existing `clear_auth_failures` call, resetting
the account's short-window tally once the _full_ login (password + second
factor) has completed. Both calls are best-effort, wrapped in
`try/except Exception: logger.debug(...)`, matching `login`'s own pattern
exactly — a detector failure must never break the login response. `login`'s
own `success=True` ordering (before the MFA branch) is unchanged by this
fix; it is a separate, lower-severity inaccuracy (a purely-alerting
detector's history resets on password-correct rather than on full auth) that
this pass is not re-ordering, since `login`'s call is scoped to the password
step specifically and doing so was not part of Codex's finding.

**Guard test:** `TestMfaLoginBruteForceWiring` in
`backend/tests/test_auth_mfa_endpoints.py` — asserts a failed MFA code calls
`detect_brute_force(db, ip="unknown", user_id=user.id, success=False)` and a
successful one calls it with `success=True`, against the real `mfa_login`
handler.

### AUTH-9 — P1 — A real concurrency race in the AUTH-7 fix itself: `_verify_and_consume_totp` had no row lock — ✅ FIXED

**What:** Codex reviewed the AUTH-7/AUTH-8 fix commit (`2640733a`) and found
that `_verify_and_consume_totp` — the very primitive AUTH-7 introduced to
make TOTP consumption atomic across routes — was not atomic across
_concurrent requests_. It read `user.mfa_last_timestep` off whatever ORM
object the caller had already loaded (via a plain, unlocked attribute
access) and wrote the consumed step back onto that same in-memory object, with
persistence deferred entirely to the caller's later `db.commit()`. Nothing
between the read and the write locked the row or re-checked the DB's current
value — a plain read-then-later-write, not a compare-and-set.

**Where:** `app/api/v1/endpoints/auth.py` — `_verify_and_consume_totp`
(former lines 778–799, pre-fix), called from all four TOTP-verifying routes
(`mfa_login`, `mfa_verify_setup`, `mfa_disable`,
`mfa_regenerate_recovery_codes`).

**Failure scenario (Codex):** a phishing relay captures a valid TOTP code
from a victim and races the SAME code against two requests simultaneously —
the attacker's own `POST /mfa/login` and the victim's legitimate request to
any of the other three management routes. Each request loads its own `User`
row (each endpoint either queries fresh or receives `current_user` from
`get_current_active_user`, both unlocked reads) before either commits. Both
see the same, not-yet-consumed `mfa_last_timestep`, both pass
`verify_totp_get_timestep`'s "newer than last consumed" check, and both
commit — the attacker's session and the victim's own legitimate session both
complete, defeating the exact single-use guarantee `_verify_and_consume_totp`'s
own docstring claims to provide. This is not hypothetical: reproduced with two
REAL, independently-committing `AsyncSession`s racing the identical code
against a real row in the test database (see Guard test below) — against the
pre-fix code, both concurrent calls returned `True`.

**Fix:** `_verify_and_consume_totp` now re-fetches the user row with
`.with_for_update().execution_options(populate_existing=True)` before
checking or consuming the code — the same locking-read pattern this codebase
already uses for every other read-then-write capacity/consistency check
(`quorum_service.calculate_quorum`, `users.py`'s profile lock,
`membership_pipeline_service.py`, `inventory_service.py`; CLAUDE.md Pitfall
#27). The lock serializes the two requests: the second blocks on the SELECT
until the first's transaction commits, then — critically —
`populate_existing=True` forces the already-in-the-session's-identity-map
`User` object to be refreshed from that fresh read rather than silently
keeping the stale value `expire_on_commit=False` (`app/core/database.py`)
would otherwise leave cached. Without `populate_existing`, the lock alone
would be acquired correctly but bought nothing: the second request would
still evaluate the replay check against the pre-lock in-memory value. The
helper became `async` (it now issues its own `db.execute`); all four call
sites updated to `await _verify_and_consume_totp(db, user, code)`.

**Guard test:** `TestVerifyAndConsumeTotpConcurrency` in
`backend/tests/test_auth_mfa_endpoints.py` —
`test_two_real_sessions_racing_the_same_code_only_one_consumes` opens two
independent connections from the app's real engine against a real row in the
test database, uses `asyncio.Event` to hold call A's transaction open (and
its row lock with it) until call B's own locking read has genuinely
suspended waiting on that lock (polled, not a fixed sleep — the test fails
loudly if B's read completes before A releases, meaning the run could not
have distinguished the fix from the race), then releases A and asserts A
returns `True` and B returns `False`. A mocked single `db` cannot exercise
this — the fix depends on a real InnoDB row lock actually blocking a second
session, which no mock reproduces. Confirmed to fail against the pre-fix
code: temporarily reverting the helper's query to a plain unlocked SELECT
(same signature, so the test needed no changes) made the guard assertion
trip with `result_b == True` — both concurrent calls consumed the code.
Three existing unit tests in `TestTotpConsumedAcrossMfaRoutes` needed a
matching `db` stand-in for the helper's new locking re-SELECT
(`_locking_db_for`, added) and an `await`, but their assertions are
unchanged.

### AUTH-10 — P2 — `login`'s brute-force-reset call fired on password-correct alone, silently defeating AUTH-8's own fix — ✅ FIXED

**What:** AUTH-8 wired `mfa_login`'s failure path to
`detect_brute_force(success=False)` so that guessing the second factor would
accumulate toward this detector's per-user HIGH alert threshold
(`failed_logins_per_user`, default 5). It deliberately left `login`'s own
pre-existing `detect_brute_force(success=True)` call unchanged, reasoning it
was a separate, lower-severity, out-of-scope inaccuracy. Codex's point: that
call fires immediately on a correct password, **before** the
`if user.mfa_enabled:` branch — including for MFA-enabled accounts, where a
correct password is not full authentication. An attacker who already knows
the password (a prerequisite for reaching the MFA step at all) can call
`POST /login` again before every MFA guess — ordinary behavior for a client
that re-establishes its `mfa_pending` token per attempt, not exotic — and
each such call resets the very tally `mfa_login`'s `success=False` call was
just wired to accumulate. The two calls fight each other: one MFA-guess
failure accumulates one entry, then the next `/login` call zeroes it before
the next guess. The alert threshold set by AUTH-8's own fix was therefore
still unreachable in practice — AUTH-8 fixed the missing call, but not the
adjacent call that kept erasing its effect.

**Where:** `app/api/v1/endpoints/auth.py` — `login`, former lines 711–717
(the `detect_brute_force(..., success=True)` call, positioned before the
`if user.mfa_enabled:` branch at former line 721).

**Failure scenario:** identical shape to the one CLAUDE.md's Attack
Protection table already documents for the separate `clear_auth_failures`
counter ("an attacker holding one leaked password for an MFA-protected
account could zero the tally at will") — except this was the
`detect_brute_force` detector, and AUTH-8 had just wired MFA failures into
it specifically to close this class of gap. Reproduced empirically: a test
driving five real `login()` + wrong-code `mfa_login()` cycles against a
fresh `SecurityMonitoringService` instance shows the per-user tally stuck at
`1` after every cycle, pre-fix — never reaching the threshold no matter how
many wrong codes are guessed, so long as the attacker's script calls
`/login` before each guess.

**Fix:** moved the `success=True` call below the `if user.mfa_enabled:`
branch, so it is only reached on the branch where a correct password _is_
full authentication (MFA disabled) — mirroring the invariant
`clear_auth_failures` immediately below it already enforced. No behavior
change to the MFA-enabled response itself (still returns `mfa_required`); the
detector's tally for an MFA-enabled account is now reset only by
`mfa_login`'s own `success=True` call, once the second factor actually
succeeds.

**Guard test:** `TestLoginBruteForceResetGating` in
`backend/tests/test_auth_mfa_endpoints.py` —
`test_login_plus_wrong_mfa_code_cycling_still_accumulates` patches a fresh,
unshared `SecurityMonitoringService` into `auth.py` (so the assertion isn't
polluted by the module singleton's cross-test state), drives 5 real
`login()` + wrong-code `mfa_login()` cycles, and asserts the per-user tally
increases by exactly 1 on every cycle (`1, 2, 3, 4, 5`) rather than being
reset back to `1` each time. Confirmed to fail against the pre-fix ordering:
reverting just the call's position reproduces the exact "stuck at 1" failure
the test's own message describes.

### AUTH-11 — P2 — An alert-write failure inside `_add_alert` could poison the caller's own commit — ✅ FIXED

**What:** `SecurityMonitoringService._add_alert` (`security_monitoring.py`)
persists a `SecurityAlertRecord` and wraps the write in
`try/except Exception: logger.warning(...)` — a failure there was already
swallowed and never raised to the caller. Codex's point was narrower and
correct: catching the exception does not undo its effect on the **session**.
Once a real `flush()` fails against the database, SQLAlchemy marks that
`AsyncSession`'s transaction as needing a rollback, and refuses every further
operation on it — including `commit()` — until one happens
(`sqlalchemy.exc.PendingRollbackError`). Both callers of `detect_brute_force`
(`login`, `mfa_login`) unconditionally `db.commit()` shortly afterward to
persist `failed_login_attempts`/lockout state on the **same** session. So a
transient alert-write failure — caught right here, exactly as designed —
still surfaced as an unhandled 500 on the caller's own later commit instead
of the endpoint's intended 401, and lost every side effect
(`failed_login_attempts`, suspicious-IP recording) the caller had already
staged in the same request.

**Where:** `app/services/security_monitoring.py` — `_add_alert` (former
lines 290–340, pre-fix): the `db.add(record); await db.flush()` sequence ran
directly against the caller's session, with no isolation.

**Checked before assuming a fix was needed, per this rotation's own rule:**
confirmed `_add_alert` had no savepoint/isolation handling despite the
extensive PR #2132 rework of this same file — that work fixed several
async-interleaving and read-after-evict races in the in-memory trackers, but
never touched `_add_alert`'s DB-write path.

**Fix:** wrapped the write in `db.begin_nested()` (a SAVEPOINT) — the exact
pattern already established in `AuditLogger.create_log_entry`
(`app/core/audit.py:190`, referenced in the #2132 work) for the identical
problem (an audit-log write failure must not break the caller's own
transaction). A failure now rolls back only the savepoint; the outer
session/transaction, and everything the caller already staged on it, is
untouched and `commit()`s normally afterward.

**Guard test:** `TestAddAlertSavepointIsolation` in
`backend/tests/test_security_monitoring.py` —
`test_alert_write_failure_does_not_poison_the_callers_commit` uses the real
`db_session` fixture (a real `AsyncSession` against the test MySQL database,
not a mock — a mocked `flush()` raising a plain exception never touches the
DBAPI transaction and cannot reproduce the "session needs rollback" state
this bug depends on) and a **real** NOT NULL constraint violation
(`SecurityAlert.description=None` — the in-memory dataclass has no runtime
type check, so it reaches `flush()` and fails there as a genuine
`IntegrityError`). After `_add_alert` swallows that failure, the test adds an
unrelated row and commits — standing in for the caller's own
`failed_login_attempts` write — and asserts that commit succeeds, plus that
the alert row was not partially persisted. Confirmed to fail against the
pre-fix code: reverting just the `begin_nested()` wrapper reproduces
`sqlalchemy.exc.PendingRollbackError` on that second commit, verbatim.

### AUTH-12 — P2 — MFA re-enrollment could spuriously fail with a false "replay" rejection — ✅ FIXED

**What:** `mfa_disable` clears `mfa_secret`/`mfa_enabled`/`mfa_backup_codes`
but, pre-fix, left `mfa_last_timestep` untouched. TOTP timesteps are
unix-time-derived (`unix_time // 30`), not secret-derived — `mfa_setup`
likewise left it untouched when installing a fresh secret. A user who
disables MFA and immediately re-enrolls with a new secret could hit
`/mfa/verify-setup` with a legitimate first code for the **new** secret that
happens to land in the same 30s wall-clock window as whatever raw timestep
number was last recorded against the **old** secret.
`verify_totp_get_timestep` rejects any code whose step is `<=
last_timestep` purely by comparing raw step numbers — it has no way to know
the two codes verify against completely different secrets.

**Where:** `app/api/v1/endpoints/auth.py` — `mfa_disable` (clearing the
secret) and `mfa_setup` (installing a fresh secret); both leave
`mfa_last_timestep` at whatever it was, pre-fix. (Checked whether a secret
can be replaced anywhere else: `mfa_setup` is the only place that writes
`mfa_secret` outside `mfa_disable`, and it can be called a second time on an
still-unconfirmed enrollment — an abandoned first attempt overwritten by a
second `/mfa/setup` call — which carries the identical exposure, so it needed
the same fix.)

**Failure scenario:** a real, if narrow, availability bug — not a security
gap. Disable-then-immediately-re-enroll is a normal recovery flow (e.g. a
user resetting MFA after losing their old authenticator app registration but
keeping the same one installed), and a spurious rejection forces a wait for
the next 30s window, worse under any clock skew. Reproduced end-to-end: a
test disables MFA with a code for an OLD secret, re-enrolls with a NEW
secret, and submits the NEW secret's current code in the same wall-clock
timestep — pre-fix, `mfa_verify_setup` rejects it as a replay of the OLD
code purely because the raw step number matches, even though the two codes
share no secret in common.

**Fix:** both `mfa_disable` and `mfa_setup` now set
`current_user.mfa_last_timestep = None` alongside the secret change, so a
freshly issued secret always starts with a clean replay-check baseline.

**Guard test:** `TestMfaLastTimestepClearedOnSecretChange` in
`backend/tests/test_auth_mfa_endpoints.py` — three tests: field-clearing
on `mfa_disable` and on `mfa_setup` individually, plus
`test_disable_then_reenroll_same_timestep_code_is_not_rejected`, the
end-to-end reproduction described above. All three confirmed to fail
against the pre-fix code (the two `mfa_last_timestep = None` lines removed):
the field-clearing tests assert a stale value directly, and the end-to-end
test reproduces the exact false-replay rejection.

### AUTH-13 — P1 — Found in the adversarial re-read: the identical unlocked read-then-write race, one field over, in the recovery-code path — ✅ FIXED

**What:** not a Codex finding — surfaced by this round's own required final
adversarial pass ("look hard for anything else the same shape" as AUTH-9)
before considering the round done. `mfa_login`'s recovery-code branch had
the exact same shape as AUTH-9's TOTP race, just on `mfa_backup_codes`
instead of `mfa_last_timestep`: it read `user.mfa_backup_codes` off the
caller's already-loaded, unlocked object, found a match, and wrote the
filtered list back with no row lock and no re-check against the database's
current value.

**Where:** `app/api/v1/endpoints/auth.py` — `mfa_login`'s recovery-code
branch (former lines 938–944, immediately below the `_verify_and_consume_totp`
call AUTH-9 had just fixed — the fix for one field sat directly above an
identical bug in the next one).

**Failure scenario:** if anything, a more attractive target than the TOTP
race AUTH-9 fixed: a recovery code has no ~30–90s expiry to outrun, so an
observed or phished recovery code stays exploitable indefinitely, not just
within a narrow window. Two concurrent `/mfa/login` requests presenting the
SAME recovery code could each load their own stale copy of
`mfa_backup_codes`, each find the code present, each filter it out of their
own in-memory copy, and each commit — both completing independent sessions
with a code that is supposed to work exactly once. Reproduced with the same
rigor as AUTH-9: two real, independently-loading sessions each performing an
unlocked read-then-write on the same recovery code both returned success
(verified via a throwaway reproduction script mirroring `mfa_login`'s actual
per-request load pattern, then deleted — not left in the tree).

**Fix:** extracted `_verify_and_consume_recovery_code(db, user, code) ->
bool`, structurally identical to AUTH-9's `_verify_and_consume_totp` fix — a
`.with_for_update().execution_options(populate_existing=True)` locking
re-read before checking/filtering the stored codes. `mfa_login`'s
recovery-code branch now calls it instead of inlining the read-check-write.

**Guard test:** `TestVerifyAndConsumeRecoveryCodeConcurrency` in
`backend/tests/test_auth_mfa_endpoints.py` —
`test_two_real_sessions_racing_the_same_recovery_code_only_one_consumes`,
same two-real-session, `asyncio.Event`-controlled-interleaving shape as
AUTH-9's guard test (including the same "B's read must actually block on
A's held lock" self-check), racing an identical recovery code instead of a
TOTP code. Confirmed to fail against the pre-fix shape: a throwaway
pytest-based reproduction using two full per-session `User` loads (matching
what the removed inline code actually did — the fixed helper's own minimal
`SimpleNamespace(id=...)` stub doesn't carry the attributes the unlocked
code path needs, so the checked-in guard test's exact harness isn't reusable
unmodified against the pre-fix shape, same as AUTH-9) printed
`result_a=True result_b=True` — both concurrent requests consumed the same
code — before being deleted.

### AUTH-5 — NIT — `validate-reset-token` docstring claimed the endpoint returns the email — ✅ FIXED (doc only)

**What:** `auth.py`'s `validate_reset_token` docstring said "Returns whether
the token is valid and the associated email," but the handler deliberately
returns only `{"valid": True}` — the inline comment directly above the
`return` even says why ("omit email to prevent user enumeration"). The
docstring and the code next to it disagreed.

**Where:** `app/api/v1/endpoints/auth.py` (the `validate_reset_token`
docstring, pre-fix).

**Failure scenario:** n/a — documentation accuracy only. Left as-is, a future
reader trusting the docstring over the code could add an email field to the
response believing one was already being returned and removed, reintroducing
the exact enumeration vector the comment next to `return` exists to prevent.

**Fix:** Docstring now states what the code does: validity only, email
intentionally omitted.

### AUTH-6 — INFORMATIONAL — Dead code in the suspicious-IP in-memory fallback contradicted its own invariant — ✅ FIXED

**What:** `_InMemoryFailureTracker.clear(ip)` in `app/core/suspicious_ip.py`
cleared **both** `self.failures` and `self.blocks` for an IP. It was never
called — `clear_auth_failures()` (the only place that resets a counter on
successful auth) calls `_memory_tracker.failures.pop(ip, None)` directly, not
`.clear()`. The module's own docstring and `clear_auth_failures`'s docstring
both state the invariant this class exists to enforce: "clearing never lifts
an active block" (mirrored in CLAUDE.md's Attack Protection table). The dead
`clear()` method did the opposite of that invariant.

**Where:** `app/core/suspicious_ip.py:117-119` (pre-fix).

**Why this matters even though it was never called:** an unused method whose
behavior contradicts a documented, load-bearing invariant is a landmine, not
neutral dead code — a future edit that "simplifies" `clear_auth_failures()` by
calling the conveniently-named `.clear()` instead of the two-line direct pop
would silently reintroduce exactly the bypass CLAUDE.md's Attack Protection
section calls out by name: "an attacker holding one leaked password... could
zero the tally at will." The Redis-backed path (`clear_auth_failures`'s
primary branch) never had an equivalent method to begin with — only `delete`
on the fail key, never touching the block key — so the in-memory fallback was
the only place this landmine existed.

**Fix:** Removed the unused method. `grep`-confirmed no caller anywhere in
`app/` or `tests/` (the one test file exercising this tracker,
`test_suspicious_ip_throttle.py`, resets state directly via
`_memory_tracker.failures.clear()` / `.blocks.clear()` — plain `dict.clear()`,
not the removed class method — so it required no change).

**Completion gate (pass 3, initial — before the AUTH-7/AUTH-8 correction):**

| Check                                                                   | Result                                                                |
| ----------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `flake8 app/ tests/ alembic/`                                           | ✅ 0 violations                                                       |
| `black --check app/ tests/ alembic/`                                    | ✅ unchanged (1351 files)                                             |
| `isort --check-only app/ tests/ alembic/`                               | ✅ clean                                                              |
| `validate_migrations.py --strict`                                       | ✅ single head, 399 revisions                                         |
| backend tests (`-k "auth or mfa or oauth or consent or suspicious_ip"`) | ✅ 216 passed, 1 skipped (pre-existing, missing optional `pywebpush`) |
| `npm run typecheck` (native compiler wrapper)                           | ✅ 0 errors                                                           |
| `npx eslint .`                                                          | ✅ 0 errors/warnings (no frontend files touched this pass)            |

**Completion gate (AUTH-7/AUTH-8 correction, this PR):**

| Check                                                                   | Result                                                               |
| ----------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `flake8 app/ tests/ alembic/`                                           | ✅ 0 violations                                                      |
| `black --check app/ tests/ alembic/`                                    | ✅ clean (1 file reformatted before commit — new test file)          |
| `isort --check-only app/ tests/ alembic/`                               | ✅ clean                                                             |
| `validate_migrations.py --strict`                                       | ✅ single head, 399 revisions                                        |
| backend tests (`-k "auth or mfa or oauth or consent or suspicious_ip"`) | ✅ 221 passed (5 new), 1 skipped (pre-existing, missing `pywebpush`) |
| `npm run typecheck` (native compiler wrapper)                           | ✅ 0 errors                                                          |
| `npx eslint .`                                                          | ✅ 0 errors/warnings (no frontend files changed this correction)     |

**Completion gate (AUTH-9 through AUTH-13, Codex round 2 on `2640733a` plus
AUTH-13 from this round's own adversarial re-read):**

| Check                                                                                                                                                                   | Result                                                                     |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `flake8 app/ tests/ alembic/`                                                                                                                                           | ✅ 0 violations                                                            |
| `black --check app/ tests/ alembic/`                                                                                                                                    | ✅ clean (1 file reformatted before commit — `test_auth_mfa_endpoints.py`) |
| `isort --check-only app/ tests/ alembic/`                                                                                                                               | ✅ clean                                                                   |
| `validate_migrations.py --strict`                                                                                                                                       | ✅ single head, 399 revisions (no migrations touched this round)           |
| backend tests (`-k "auth or mfa or oauth or consent or suspicious_ip"`)                                                                                                 | ✅ 227 passed, 1 skipped (pre-existing, missing `pywebpush`)               |
| `backend/tests/test_security_monitoring.py` (full file, run directly — the keyword filter above does not match this file's name/test IDs, and AUTH-11's fix lives here) | ✅ 28 passed (1 new)                                                       |
| `npm run typecheck` (native compiler wrapper)                                                                                                                           | ✅ 0 errors                                                                |
| `npm run lint`                                                                                                                                                          | ✅ 0 errors/warnings (no frontend files changed this round)                |

7 new regression tests total (1 `TestVerifyAndConsumeTotpConcurrency`, 1
`TestLoginBruteForceResetGating`, 3 `TestMfaLastTimestepClearedOnSecretChange`,
1 `TestAddAlertSavepointIsolation`, 1
`TestVerifyAndConsumeRecoveryCodeConcurrency`), each individually confirmed
to fail against `2640733a` (or, for AUTH-13, against the equivalent pre-fix
shape — see its own Guard test note) and pass after its fix.

---

## Pass 2 (2026-08-27)

`git diff` between PR #1804's merge commit (`9a58e352`) and current `main`
shows **zero changes** to `auth.py`, `auth_service.py`, `mfa_service.py`, or
`oauth_service.py` — byte-identical. AUTH-1's fix
(`Organization.active.is_(True)` + fail-closed `(None, "no_account")` in
`oauth_service.py:57-77`) is confirmed still present, and its guard test
(`test_resolve_user_no_active_organization`) still passes. The route count is
unchanged at 26.

`consent_service.py` is the one file in this feature's scope that grew
(84 L → 211 L) since pass 1, entirely from a new "Photo Use Consent" feature
(commits `4b68b3da`, `d5bb37ce`, `fd3c797f` — a new `roster()` method, a new
`GET /users/consents/photo-use` endpoint in `users.py`, a new
`users.view_consents` permission, and a frontend `PhotoUseConsentPage.tsx`).
Read in full against all seven checklist dimensions, since none of it existed
at pass 1:

- **Tenant isolation (dim. 3):** `roster()` takes `organization_id` as a
  parameter and filters `User.organization_id` directly, plus a belt-and-
  suspenders `UserConsent.organization_id == organization_id` on the outer
  join condition (commented as "redundant against the org filter on User,
  kept so the join can never pull a row from another tenant"). Correct.
- **Authorization fit (dim. 2):** the endpoint's `require_permission` list
  (`users.view_consents`, `notifications.manage`, `members.manage`,
  `users.edit`) was deliberately built to avoid the XC-2 pattern this
  checklist watches for — the code comment explains why `users.view` (held by
  25 of 30 default positions) was rejected as too broad for a whole-department
  consent roster, and why the new narrow permission exists instead of
  widening an existing broad one. This is the checklist's own dimension-2
  concern, already reasoned through by the author.
- **Data exposure (dim. 5):** `roster()`'s docstring and code both explicitly
  exclude contact fields ("Returns no contact fields... a second list carrying
  it unconditionally would quietly undo [the member directory's
  contact-visibility gate]") — returns only name/rank/station/membership
  number/photo_url, which is what identifies someone on a photo call sheet.
  Caching: `/users` (no trailing slash) is already in `UNCACHEABLE_PREFIXES`
  and matches every consent sub-path via `startsWith` — no separate entry
  needed, verified by grep rather than assumed.
- **Fan-out helper `granted_user_ids`** (used by
  `notification_channels.resolve_sms_recipients`) does not itself filter
  `organization_id`, but its only caller passes an already org-scoped `users`
  list and the function can only _narrow_ that set (intersect with consent),
  never add ids beyond what the caller supplied — resolves through an
  already-org-scoped parent, not a gap.
- **Schema & migration integrity (dim. 7):** `ConsentType.PHOTO_USE` already
  existed at pass 1 (no model/column change needed); the new
  `20260825_1900_c4a91b7e2f08_grant_users_view_consents.py` migration is a
  seeded-grant backfill and does everything Pitfall #23 + #26 require: scoped
  to `is_system = True`, rewrites a row only when its stored permissions still
  exactly equal a frozen `_PRIOR_DEFAULTS` snapshot (so a department that
  already customized the position is left alone), guards on the `positions`
  table's existence before reflecting it (`create_all`-only table, Pitfall
  #26), and ships both `upgrade()` and a symmetric `downgrade()`.
- No `window.confirm`/`alert`/`prompt`, no direct `fetch`/raw `axios` in
  `PhotoUseConsentPage.tsx` (grep-confirmed — it goes through the shared
  service layer feature 34 already reviewed).

**Correction (Codex review on PR #1929):** the "no findings" conclusion above
was wrong on two counts, both raised by Codex against `PhotoUseConsentPage.tsx`
and `consent_service.py`.

### AUTH-3 — LOW — Stale roster response could overwrite a newer one — ✅ FIXED

**What:** `PhotoUseConsentPage.tsx`'s `loadRoster` fired a new
`getPhotoUseConsentRoster(includeInactive)` request on every change to the
`includeInactive` toggle with no cancellation or staleness check. Toggling the
checkbox twice in quick succession (check, then uncheck before the first
request resolves) let the two requests resolve out of order; whichever
response landed last overwrote `roster` via `setRoster`, regardless of whether
it still matched the toggle's current value.

**Where:** `frontend/src/modules/communications/pages/PhotoUseConsentPage.tsx`
(the `useEffect`/`loadRoster` pair).

**Failure scenario:** a PIO toggles "Include inactive members" on and then
immediately back off while choosing photos. If the first (checked) request is
slow and resolves after the second (unchecked) one, the roster silently
reverts to including inactive members — with the checkbox itself showing
unchecked, a display state inconsistent with what's on screen. Each member's
own `granted`/`declined` value is unaffected (the race is only over which
members appear, not their consent state), but the page is documented as "the
operational enforcement point" for photo consent, so a PIO trusting the
checkbox to reflect what's listed is a real, if narrow, correctness bug.

**Fix:** moved the fetch into the `useEffect` body with the codebase's
existing `let cancelled = false` / cleanup-sets-`cancelled=true` idiom (same
pattern as `PipelineDetailPage.tsx`), so a response belonging to a superseded
effect run is never applied to state.

**Guard test:** `ignores a stale response that resolves after a newer request
for a different toggle state` in `PhotoUseConsentPage.test.tsx` — two requests
in flight, the older one resolved last; asserts the newer request's roster
wins. Verified to fail against the pre-fix component (confirmed by stashing
the fix and re-running) and pass against it.

### AUTH-4 — INFORMATIONAL — Unbounded roster query, flagged not fixed

**What:** `ConsentService.roster()` has no `LIMIT`/pagination and materializes
every matching member with `result.all()`; `GET /users/consents/photo-use`
passes that straight through. Checklist dimension 6 names "no `all()` over an
org-wide table" as a pattern to catch.

**Where:** `backend/app/services/consent_service.py:118-143`.

**Why flagged, not fixed:** this is not a defect unique to the new code —
grepping `select(User` across `app/` finds **255+ other call sites** with the
identical unbounded shape (`/officers`, the base `/users` list, and most other
whole-department rosters). The application's own scale assumption throughout
is a single fire department's membership (tens to a few hundred rows), not an
org-wide table that grows without bound the way `audit_logs` or
`message_history` do — dimension 6's concern is real for those, and this
codebase already bounds or paginates them. Adding a `LIMIT` to this one new
endpoint while its 255 siblings stay unbounded would be an arbitrary,
inconsistent fix, not a security improvement. Recorded here for awareness
rather than actioned as a drive-by; a genuine fix would be an app-wide
pagination pass, out of scope for this iteration.

**Completion gate (pass 2, after AUTH-3):** flake8/black/isort clean on `app/
tests/ alembic/`; `validate_migrations.py --strict` passed (381 revisions,
single head); scoped backend tests (`-k "oauth or auth_service or mfa or
consent"`) 70 passed, 1 skipped (pre-existing, missing optional dependency);
`tsc --noEmit` 0 errors; `eslint .` 0 errors (1 file, 0 warnings);
`PhotoUseConsentPage.test.tsx` 7/7 passed (1 new).

---

## Pass 1 (2026-08-25)

**Backend:** `app/api/v1/endpoints/auth.py` (1405 L, 26 endpoints),
`app/services/auth_service.py` (970 L), `app/services/mfa_service.py` (121 L),
`app/services/oauth_service.py` (327 L), `app/services/consent_service.py`
(84 L), `app/models/consent.py`
**Frontend:** `stores/authStore.ts`, `services/apiClient.ts`,
`utils/createApiClient.ts`, login/MFA pages
**Migrations:** `20260801_0019_add_user_consents.py` (consent table)

---

## Scope

This feature already carries two prior application-review passes
(`docs/app-review/auth-session.md`, 2026-08-05 and 2026-08-08) that did a
six-lens sweep and a full 25/26-endpoint auth-dependency enumeration. This
iteration does **not** re-derive that work. It re-verifies a sample of the
prior claims against current code (auth-dependency spot-check across 5 routes,
both public and private) and applies full weight to the checklist dimensions
those passes covered lightly: tenant isolation, injection/untrusted output,
data exposure, abuse resistance, and schema/migration integrity. All 5 backend
files and the frontend auth surfaces were read in full or by targeted grep;
nothing was sampled without a stated reason.

`git log` for these files could not be trusted to date changes since
2026-08-08 (history for this path appears to have been squashed/rewritten —
the earliest dateable commit touching these files is 2026-08-21). `CHANGELOG.md`
was used as the dating source of record instead and cross-checked against the
current code for every claim below.

## Route inventory

Full enumeration (26 routes, not the 25 the prior pass recorded —
`GET /captcha-config` was omitted from that count; see AUTH-2).

| Method | Path                        | Auth dependency                 | Permission       | Org-scoped | Notes                                                  |
| ------ | --------------------------- | ------------------------------- | ---------------- | ---------- | ------------------------------------------------------ |
| GET    | `/branding`                 | none                            | n/a              | n/a        | public, no secrets exposed                             |
| GET    | `/captcha-config`           | none                            | n/a              | n/a        | public, site key only (not the secret)                 |
| GET    | `/oauth-config`             | none                            | n/a              | n/a        | public, provider-enabled flags only                    |
| GET    | `/oauth/google`             | none                            | n/a              | n/a        | public, initiates redirect                             |
| GET    | `/oauth/google/callback`    | none                            | n/a              | n/a        | public, state verified via `compare_digest`            |
| GET    | `/oauth/microsoft`          | none                            | n/a              | n/a        | public, initiates redirect                             |
| GET    | `/oauth/microsoft/callback` | none                            | n/a              | n/a        | public, state verified via `compare_digest`            |
| POST   | `/register`                 | none                            | n/a              | n/a        | rate-limited; 403 unless `REGISTRATION_ENABLED`        |
| POST   | `/login`                    | none                            | n/a              | n/a        | rate-limited + `enforce_suspicious_ip`                 |
| POST   | `/mfa/login`                | none (pre-auth MFA token)       | n/a              | n/a        | rate-limited; token-scoped                             |
| POST   | `/mfa/setup`                | `get_current_active_user`       | self             | self       | —                                                      |
| POST   | `/mfa/verify-setup`         | `get_current_active_user`       | self             | self       | rate-limited                                           |
| POST   | `/mfa/disable`              | `get_current_active_user`       | self             | self       | rate-limited                                           |
| GET    | `/mfa/status`               | `get_current_active_user`       | self             | self       | —                                                      |
| POST   | `/mfa/recovery-codes`       | `get_current_active_user`       | self             | self       | rate-limited                                           |
| GET    | `/mfa/policy`               | `get_current_active_user`       | self             | org        | —                                                      |
| PUT    | `/mfa/policy`               | `get_current_active_user`       | admin permission | org        | —                                                      |
| POST   | `/refresh`                  | none (refresh token via cookie) | n/a              | n/a        | rate-limited; org-active check (`auth_service.py:382`) |
| POST   | `/logout`                   | `get_current_user`              | self             | self       | —                                                      |
| GET    | `/me`                       | `get_current_active_user`       | self             | self       | —                                                      |
| GET    | `/session-settings`         | `get_current_user`              | self             | self       | —                                                      |
| POST   | `/change-password`          | `get_current_active_user`       | self             | self       | rate-limited                                           |
| GET    | `/check`                    | none (cheap probe)              | n/a              | n/a        | intentionally minimal, no full permission build        |
| POST   | `/forgot-password`          | none                            | n/a              | n/a        | rate-limited; enumeration-safe                         |
| POST   | `/reset-password`           | none                            | n/a              | n/a        | rate-limited; SHA-256 token lookup                     |
| GET    | `/validate-reset-token`     | none                            | n/a              | n/a        | rate-limited; returns `{"valid": bool}` only           |

11 public / 15 private. Every private route carries `get_current_user` or
`get_current_active_user`; both admin-scoped routes (`/mfa/policy` PUT, and
admin MFA reset / consent listing which live in `users.py`, out of this
feature's file scope) additionally org-scope the target by id.

## Verified good ✅

- **Auth-dependency spot-check (5 routes sampled, public and private) still
  matches the prior enumeration.** `/branding` and `/login` remain
  unauthenticated by design; `/me`, `/change-password`, `/session-settings`
  all carry `get_current_user`/`get_current_active_user`. No drift.
- **Tenant isolation on consent data.** `UserConsent` (`models/consent.py:41`)
  has `organization_id` and `user_id` both `NOT NULL` with `ondelete="CASCADE"`
  — matches its migration exactly, no drift. The admin-facing consent listing
  and admin MFA reset (in `users.py`, adjacent to this feature) org-scope the
  by-id target before acting, and MFA reset enforces a privilege ceiling and
  blocks self-reset. (Read as supporting context; full review of `users.py`
  itself is feature 07 in the rotation, not re-litigated here.)
- **No injection surface.** Zero raw SQL and zero `.like()`/`.ilike()` calls in
  any of the 5 in-scope files (grep-confirmed) — Pitfall #25 does not apply to
  this feature. OAuth state and TOTP/recovery-code comparisons use
  `secrets.compare_digest`; redirect targets are server config, never
  client-supplied — no open-redirect vector. `reason` codes passed through
  `_oauth_fail_redirect` are a fixed short enum, never raw user input.
- **No unbounded in-memory caches** in these 5 files (Pitfall #9 n/a here —
  the actual rate-limit/suspicious-IP trackers live in `security_middleware.py`
  / `suspicious_ip.py`, out of this feature's scope and already audited via the
  `get_client_ip` sweep in the prior pass).
- **Data exposure remains clean.** `validate_reset_token` returns
  `{"valid": bool}` only; tokens are never placed in JSON bodies (httpOnly
  cookies only, per `_set_auth_cookies`); the reset link uses a URL fragment,
  not a query param, to keep the token out of Referer headers and access logs.
  Frontend `authStore.ts` writes only a `has_session` boolean flag to
  `localStorage` — grep confirms no token writes, and the only reads of the
  legacy token keys are one-time cleanup code that removes them. No
  `window.confirm`/`alert`/`prompt` anywhere in the auth frontend surfaces.
- **Rate limiting still covers every credential-guessing path**: login, MFA
  login, MFA verify-setup/disable/recovery-codes, refresh, change-password,
  register, and all three reset routes each carry a `rate_limit_*` dependency.
- **Schema/migration integrity.** `consent.py`'s FKs are `ondelete="CASCADE"`
  with `nullable=False` — not a `SET NULL` case, so Pitfall #2 doesn't apply;
  the migration matches the model column-for-column, including the
  `(user_id, consent_type)` unique index. No drift.

## Findings

### AUTH-1 — MED — OAuth login skipped the organization-active check — ✅ FIXED

**What:** `oauth_service._link_existing_user` scoped its org lookup to the
earliest-created organization with no `active` filter, and — when that lookup
came back empty — dropped the org filter from the user query entirely instead
of failing closed.

**Where:** `app/services/oauth_service.py:50` (pre-fix).

**Failure scenario:** The 2026-08-12 hardening pass added
`Organization.active.is_(True)` to the password-login path
(`auth_service.authenticate_user`), specifically so members of a deactivated
organization can no longer sign in with a password. The OAuth path was never
given the same filter — tracked as an open MED item in
`docs/KNOWN_LIMITATIONS.md` since that date. A member of a deactivated
organization whose account is Google- or Microsoft-linked could still sign in
via OAuth, bypassing the exact control password login now enforces. Worse: had
the org lookup ever come back empty for any reason (not just deactivation —
e.g. an empty `organizations` table in a fresh/test environment), the code
dropped the `organization_id` filter from the user query altogether, so the
email-match query would have matched a user in **any** organization — a
tenant-isolation gap (dimension 3), not just an availability one.

**Impact:** Deactivating an organization is expected to lock out all of its
members; OAuth-linked members retained access. In the empty-org-table edge
case, the missing filter could also have crossed a tenant boundary.

**Fix:** The org lookup now carries `.where(Organization.active.is_(True))`,
and an empty result returns `(None, "no_account")` immediately — the same
indistinguishable error password login's candidate-empty case produces,
preserving the enumeration-avoidance convention this file already follows
elsewhere. This removes both the deactivated-org bypass and the fail-open path
on an empty lookup. Mirrors `auth_service.authenticate_user`'s existing,
already-tested pattern exactly, rather than inventing a new one.

**Guard test:** `test_resolve_user_no_active_organization` in
`backend/tests/test_oauth_service.py` — asserts the org query text contains
`organizations.active IS true`, and that a missing active org returns
`(None, "no_account")` without ever issuing the user-lookup query (so a
regression back to the fail-open path fails this test rather than merely
returning a wrong-but-harmless result).

### AUTH-2 — NIT — Prior review's route count and M2 claim had drifted from current code — ✅ FIXED (docs only)

**What:** `docs/app-review/auth-session.md` (2026-08-08 pass) stated 25
endpoints (10 public / 15 private) and listed the 2026-08-08 refresh-grace-
window fix as still intact. Neither matches current code: there are 26 routes
(`GET /captcha-config` was omitted from the original count — it is correctly
public, exposing only a CAPTCHA site key, so this was a documentation gap, not
a security bug), and the refresh grace window was intentionally removed on
2026-08-12 (CHANGELOG, same date) because it was itself a replay-window
vulnerability — a stale token now revokes the whole session immediately, with
no grace fallback.

**Where:** `docs/app-review/auth-session.md`.

**Failure scenario:** n/a — documentation accuracy only. Left uncorrected, a
future reviewer re-verifying "M2 fix intact" against current code would either
report a false claim as re-confirmed, or waste time reconciling a described
mechanism that no longer exists.

**Fix:** Added a "Pass 3" correction section to `auth-session.md` recording
both drifts and pointing to this file for AUTH-1.

## Schema & migration notes

`consent.py` / `20260801_0019_add_user_consents.py` — no drift, both FKs
`ondelete="CASCADE"` + `nullable=False` (not a `SET NULL` case), unique index
matches. No other migration touches this feature's tables since the last pass.

## Guard tests added

- `test_resolve_user_no_active_organization` (`test_oauth_service.py`) — fails
  if the OAuth org lookup ever drops the `active` filter or stops failing
  closed on an empty result.

## Completion gate

| Check                                         | Result                                  |
| --------------------------------------------- | --------------------------------------- |
| `flake8 app/ tests/ alembic/`                 | ✅ 0 violations                         |
| `black --check app/ tests/ alembic/`          | ✅ unchanged                            |
| `isort --check-only app/ tests/ alembic/`     | ✅ clean                                |
| `validate_migrations.py --strict`             | ✅ single head                          |
| backend tests (scoped: oauth/auth/active-org) | ✅ 22 passed                            |
| `tsc --noEmit`                                | ✅ 0 errors (no frontend files touched) |
| `eslint .`                                    | n/a — no frontend files touched         |
