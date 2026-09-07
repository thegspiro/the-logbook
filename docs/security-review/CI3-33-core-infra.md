# Security Review — Feature 33: Core Infrastructure (pass 3)

**Prefix:** `CI3` · **Iteration:** 33 · **Reviewed:** 2026-09-07 · **PR:** (opened this pass)

**Backend:** `app/core/security_middleware.py` (1,450 L → 1,541 L after the
Codex-caught follow-up round), `app/core/config.py` (1,041 L),
`app/core/database.py` (257 L). Cross-referenced (not modified):
`app/services/auth_service.py`, `app/api/v1/endpoints/auth.py`,
`app/models/user.py` — reached from a `config.py` dead-switch check, see
CI3-33-3.
**Frontend:** none this pass.
**Migrations:** none — no schema change.

This is the rotation's third pass on Core Infrastructure, following
[`CI-33-core-infra.md`](./CI-33-core-infra.md) (2026-08-31, PR #2106/#2107 —
17 findings across two prior passes, all fixed) and
[`CI2-33-core-infra.md`](./CI2-33-core-infra.md) (2026-08-27, PR #1917 — 14
findings, all fixed). **4 new findings in `RateLimiter`, all fixed** (a
previously-undetected defect class shared with
`app/services/security_monitoring.py`'s tracker-cap logic, found
independently here): CI3-33-1/2 in the round opened as PR #2368, and
CI3-33-1a/1b — Codex-caught gaps in those same two fixes, found on review of
the open PR and fixed in a follow-up round before merge. **2 dead
config-switch findings, both flagged** — one HIGH (an access-control gate
with zero effect), one LOW (four minor tuning knobs). All 17 prior findings
re-verified still fixed, at current line numbers.

---

## Scope

**Read in full, this pass:** `security_middleware.py` (all 1,450 lines),
`database.py` (all 257 lines), and — for the first time in this rotation's
own words, since CI-33 pass 3 explicitly scoped it to four spot-checked
locations plus a `git diff` proof rather than a fresh full read —
`config.py` (all 1,041 lines).

**Not touched this pass:** `security.py`, `cache.py`, `websocket_manager.py`,
`encrypted_types.py` — outside this feature's declared scope per CI2-33/CI-33
(covered by the module-audit and reviewed under other rotation features).
`app/services/security_monitoring.py` is also out of this feature's file
scope (it belongs to Feature 28's rotation, security-audited at length in
`docs/security-review/SEC-00-cross-cutting-baseline.md`'s five-round
tracker-cap saga) — referenced here only because `RateLimiter`, which _is_
in scope, turned out to share the exact defect shape that file's trackers
needed five rounds to fully close.

## Re-verification of prior findings

Every fix from CI-33 (CI-33-1/2/3, plus CI2-33-1 through 13) checked against
the live file at its current location, not assumed from the prior write-up:

| id                  | fix                                                                                                                                | still present? |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| CI-33-1             | `RateLimiter.is_rate_limited`'s lockout-expiry branch only pops request history when `lockout_seconds > 0` (`:157`)                | ✅             |
| CI-33-2             | `daily_cap_exceeded` self-heals a missing TTL after a successful `INCR` (`:268-270`)                                               | ✅             |
| CI-33-3             | `DatabaseManager.disconnect()` resets `engine`/`session_factory` in `finally` even when `dispose()` raises (`database.py:187-196`) | ✅             |
| CI2-33-1            | `SecurityMonitoringMiddleware` reads `request.state.authenticated_user` after `self.app()` returns (`:1386-1395`)                  | ✅             |
| CI2-33-2            | `RateLimiter._evict_stale` judges each key's staleness against its own recorded `_key_windows[k]` (`:81-88`)                       | ✅             |
| CI2-33-3            | `database.py connect()` re-raises only the scrubbed detail, `from None` (`:175-179`)                                               | ✅             |
| CI2-33-4            | `config.py:388-393` boot check rejects any `ALGORITHM != "HS256"`                                                                  | ✅             |
| CI2-33-5            | `config.py:596-605` warns when `AUDIT_LOG_SIGNING_KEY` is unset                                                                    | ✅             |
| CI2-33-6            | `config.py:562-594` warns on `CAPTCHA_ENABLED` with an empty/missing/unsupported secret, site key, or provider                     | ✅             |
| CI2-33-7            | `IPLoggingMiddleware` only reuses an incoming `X-Request-ID` matching `_REQUEST_ID_RE` (`:1177`, `:1214-1219`)                     | ✅             |
| CI2-33-8            | `config.py:406-420` warns on a `TRUSTED_PROXY_IPS` entry narrower than the IPv4/IPv6-aware minimum                                 | ✅             |
| CI2-33-9            | `InputSanitizer.sanitize_string` escapes before truncating and trims a cut entity (`:332-348`)                                     | ✅             |
| CI2-33-10           | onboarding CSRF bypass is `request_path.startswith("/api/v1/onboarding")` (`:846`)                                                 | ✅             |
| CI2-33-11 / CI-33-3 | `is_connected` computed property; `disconnect()` resets both fields even on a failed `dispose()`                                   | ✅             |
| CI2-33-12           | `InputSanitizer.validate_url` rejects a bare IPv4-literal host (`:453-460`)                                                        | ✅             |
| CI2-33-13           | injection-detection dead body-buffering is gone; docstring states no such analysis runs (`:1288-1293`)                             | ✅             |

`main.py`'s middleware registration block (lines ~2050-2114) is unchanged
from CI2-33/CI-33's description — `SecurityHeadersMiddleware` first,
`TrustedHostMiddleware` conditionally, `SecurityMonitoringMiddleware` in
production only, `IPBlockingMiddleware`/`IPLoggingMiddleware` conditionally,
`CORSMiddleware`, `GZipMiddleware`, `RequestSizeLimitMiddleware` last
(outermost, ahead of any body buffering). Ordering comments in each
middleware class still match the registration order.

**Known limitation, re-confirmed still open, not re-flagged:**
`SecurityMonitoringMiddleware.EXPORT_ENDPOINTS`' exact-match set still
structurally cannot cover `training_programs.py`'s parameterized
`/programs/{program_id}/export` route — documented in CI2-33, CI-33, and
`docs/KNOWN_LIMITATIONS.md`. Verified the current set (15 entries,
`security_middleware.py:1306-1322`) is unchanged.

## Findings

### CI3-33-1 — MED — `RateLimiter`'s MAX_KEYS force-eviction could silently lift an active lockout for _any_ key, triggered by an unrelated call — ✅ FIXED

**What:** `RateLimiter._evict_stale`'s forced eviction-by-recency loop
(triggered once the tracker exceeds `_MAX_KEYS`, ranking every key by its
last-request timestamp) unconditionally called `self.lockouts.pop(key,
None)` for every key it evicted from `self.requests` — with no check for
whether that key currently held an _active_ (unexpired) lockout, and
regardless of which key's call actually triggered the sweep.

**Where:** `backend/app/core/security_middleware.py`,
`RateLimiter._evict_stale`'s forced-eviction block (was lines 93-104).

**Failure scenario:** an attacker's IP gets locked out (e.g. after 5 failed
login attempts within 60s, per `rate_limit_login()`'s 1800s lockout). Its
last _request_ timestamp (from before the lockout began) can still rank as
the globally-oldest entry in the tracker, since a lockout does not touch
`self.requests`. If the shared, process-wide `rate_limiter` instance (used
as the in-memory fallback whenever Redis is down, on **any** rate-limited
scope — login, register, password reset, token refresh, password change,
and every `public_rate_limit()` caller) exceeds `_MAX_KEYS` (10,000) —
plausible during exactly the sustained-traffic conditions a Redis outage
under load produces — the forced-eviction sweep triggered by **any other
key's** call could pick the locked-out attacker's entry among the
oldest-by-recency and delete `self.lockouts[key]`, silently ending the
lockout minutes or hours before its real expiry. The request-history
eviction itself is harmless for a locked-out key (`is_rate_limited` returns
on the lockout check before ever touching `self.requests`) — only the
lockout-dict pop had an observable effect.

**Impact:** during the exact window this fallback exists to protect (a
Redis outage under load), an attacker's lockout could be lifted early by
unrelated traffic, letting them resume brute-force/spam attempts against a
public or auth endpoint ahead of schedule with no signal that the lockout
ended prematurely.

**Fix:** the forced-eviction loop no longer pops `self.lockouts[key]`.
Anything still present in `self.lockouts` at that point in `_evict_stale` is
by construction an _active_ lockout — expired ones were already removed by
the `expired_lockouts` sweep a few lines earlier in the same call — so it
must survive until it naturally expires via that sweep on a later call.
Reproduced and verified against pre-fix code (see Guard tests).

### CI3-33-2 — MED — `RateLimiter.is_rate_limited` could wipe its own key's request history via its own call's forced eviction, undercounting the request — ✅ FIXED

**What:** the request-history read/filter/append at the end of
`is_rate_limited` happened _after_ `_evict_stale` ran — the same
read-after-evict ordering hazard this rotation spent five review rounds
finding and fixing across `app/services/security_monitoring.py`'s trackers
(`docs/security-review/SEC-00-cross-cutting-baseline.md`), present here
independently in `RateLimiter` and never previously flagged in this file.

**Where:** `backend/app/core/security_middleware.py`,
`RateLimiter.is_rate_limited` (was lines 106-179).

**Failure scenario:** this one process-wide `rate_limiter` instance is
shared across every scope that falls back to it, with windows ranging from
60s (login) to 3600s (`data_export`, per CI2-33-2). If the tracker exceeds
`_MAX_KEYS` and the _calling key's own_ last-recorded activity happens to
rank as the globally-oldest entry among the over-cap set — plausible for a
long-window key sitting next to a flood of short-window keys, or simply an
infrequent caller during a burst of new distinct IPs — the forced eviction
deletes that exact key's history immediately before the call reads it. The
key's count is then computed from an empty list, undercounting the true
number of prior requests and granting extra allowance it should not have
had. Reproduced directly: a key with 2 prior requests toward a
`max_requests=3` cap, force-evicted by its own triggering call, showed only
1 recorded request afterward instead of 3, and a subsequent request that
should have been blocked was allowed.

**Impact:** a rate limit silently weakened during the exact fallback window
(Redis outage, or simply high key cardinality) it exists to protect,
identical in shape and severity class to CI2-33-2's original finding but in
code CI2-33-2's own fix did not touch.

**Fix:** `is_rate_limited` now reads `self.requests.get(key, [])` **before**
calling `_evict_stale`, and writes the filtered result back to
`self.requests[key]` explicitly (both on the lockout-triggering path and the
allowed path) rather than re-reading `self.requests[key]` afterward — the
same read-before/write-after-evict shape already applied across
`security_monitoring.py`'s five trackers. Reproduced and verified against
pre-fix code (see Guard tests).

### CI3-33-1a — MED — CI3-33-2's fix restored a forced-evicted key's request history but not its window metadata — ✅ FIXED (Codex review of PR #2368)

**What:** CI3-33-2's fix captures `self.requests.get(key, [])` before
`_evict_stale` runs and writes the filtered result back afterward, so a
forced-evicted key's request history survives its own eviction pass. But
`self._key_windows[key]` — set at the very top of `is_rate_limited`, i.e.
_before_ `_evict_stale` runs, so it is just as visible to (and undoable by)
the same forced-eviction loop, which pops it for every key it evicts — was
never restored the same way.

**Where:** `backend/app/core/security_middleware.py`,
`RateLimiter.is_rate_limited` (the gap was between the `self._key_windows[key]
= window_seconds` assignment near the top of the method and the eviction
call a few lines later).

**Failure scenario:** a long-window key (e.g. a 3600s `data_export` scope)
gets force-evicted from `self.requests` during its own call because it
ranks globally-oldest among an over-cap tracker. CI3-33-2 correctly
restores `self.requests[key]` for _this_ call, but `self._key_windows[key]`
is left missing. On the _next_ sweep — possibly triggered by an entirely
different, short-window scope (e.g. 60s login) — `_evict_stale`'s
individual staleness check reads `self._key_windows.get(k, window_seconds)`
for this key; with no recorded window, it falls back to the _triggering
call's_ `window_seconds` (60s) instead of the key's real one (3600s). If
the key has been quiet for more than 60s (but well within its real 3600s
window), it gets wiped — CI2-33-2's exact bug, reintroduced by omission in
CI3-33-2's own fix. Reproduced directly: a key with a 3600s window, force-
evicted once by its own over-cap call (window metadata confirmed missing
immediately after), then wiped on the very next sweep triggered by an
unrelated 60s-window call despite being only 65 seconds quiet.

**Impact:** the same rate-limit weakening class as CI2-33-2 and CI3-33-2,
reachable through the fix that was supposed to close CI3-33-2.

**Fix:** `self._key_windows[key] = window_seconds` is now re-asserted
immediately after `_evict_stale` returns (in addition to the existing
assignment before it, which is still needed so the individual staleness
check judges this key's _own_ prior entry, if any, against the correct
window during that same sweep). The re-assignment after eviction is
unconditional and a no-op when eviction didn't touch it, so it costs
nothing on the common path. Reproduced and verified against pre-fix code
(see Guard tests).

### CI3-33-1b — MED — CI3-33-1's fix removed the only cap that had ever bounded `self.lockouts`' size — ✅ FIXED (Codex review of PR #2368)

**What:** CI3-33-1 correctly stopped the `_MAX_KEYS` forced-eviction loop
from popping `self.lockouts[key]` for evicted keys — necessary, since that
was silently ending active lockouts early. But that pop had also been the
_only_ mechanism that ever bounded `self.lockouts`' size: it was capped
purely as a side effect of being removed whenever its matching
`self.requests` entry was force-evicted. Decoupled, `self.lockouts` had no
cap of its own — the exact shape CLAUDE.md Pitfall #9 exists to prevent
("any in-memory dict/set used for tracking must have a maximum size cap").

**Where:** `backend/app/core/security_middleware.py`,
`RateLimiter._evict_stale` (the forced-eviction block CI3-33-1 modified had
no independent bound on `self.lockouts`).

**Failure scenario:** during a Redis outage (this limiter's fallback
window — the same condition CI3-33-1/CI3-33-2 already establish as the one
that matters most), a flood of distinct attacker IPs each trip the lockout.
`self.requests` stays correctly bounded at `_MAX_KEYS`, but nothing bounds
`self.lockouts` — it grows one entry per distinct attacker for the full
`lockout_seconds` duration (up to 1800s by default, longer for some
scopes), a memory-exhaustion DoS scaling with attack volume rather than a
fixed cap. Reproduced directly: 500 distinct attacker IPs each tripping a
1800s lockout against a `_MAX_KEYS=100` limiter left `self.requests` at
exactly 100 entries but `self.lockouts` at all 500.

**Impact:** an in-memory tracker with no cap, reachable during exactly the
degraded-Redis window this limiter exists to protect — the same impact
class Pitfall #9 documents, on a security-critical structure.

**Fix:** a new, independent `_MAX_LOCKOUTS` cap (10,000, matching
`_MAX_KEYS`'s scale). When `self.lockouts` exceeds it, `_evict_stale` evicts
the _soonest-to-expire_ entries first — not by request recency (which
would reintroduce CI3-33-1's mistake) and not by an arbitrary order: an
entry about to expire naturally anyway costs the least "early unlock"
impact to remove, while an entry expiring far in the future is the most
valuable to an attacker to have lifted early, so it is evicted last. The
eviction gate (`over_limit`) now also triggers immediately when
`self.lockouts` alone exceeds its cap, not only when `self.requests` does,
so an over-cap lockouts dict doesn't have to wait up to
`_EVICTION_INTERVAL` (60s) while it keeps growing. To avoid reintroducing
CI3-33-1's exact self-eviction hazard in a new form — a call evicting its
_own_ still-active lockout via its _own_ call's cap-eviction pass —
`is_rate_limited` now also captures `self.lockouts.get(key)` before
`_evict_stale` runs and uses that captured value (restoring the dict entry
if eviction removed it) rather than re-reading `self.lockouts[key]`
afterward, mirroring CI3-33-2's read-before/write-after-evict pattern for
lockouts as well as request history. Reproduced and verified against
pre-fix code (see Guard tests), including the self-eviction case
specifically (a key whose own lockout is the soonest-to-expire among an
over-cap tracker must still see itself as locked out).

### CI3-33-3 — HIGH — `REGISTRATION_REQUIRES_APPROVAL` has no reader anywhere; every self-registered account is immediately active — FLAGGED

**What:** `config.py:300` declares `REGISTRATION_REQUIRES_APPROVAL: bool =
True` with a doc comment claiming "New registrations require admin
approval" — and `POST /auth/register`'s own docstring
(`auth.py:571-572`) repeats the claim: "new accounts require admin approval
if REGISTRATION_REQUIRES_APPROVAL is true." Neither claim is true. An
exhaustive grep of `app/` for `REGISTRATION_REQUIRES_APPROVAL` finds only
the declaration itself and this one docstring mention — the setting is read
by **nothing**. There is also no mechanism it could be wired into:
`UserStatus` (`models/user.py:108-119`) has no pending/unapproved value
(`ACTIVE`, `INACTIVE`, `SUSPENDED`, `PROBATIONARY`, `LEAVE`, `RETIRED`, two
`DROPPED_*` values, `ARCHIVED` — none represents "awaiting admin review"),
and `AuthService.register_user()` (`auth_service.py:446-549`)
unconditionally sets `status=UserStatus.ACTIVE` on the new row.

**Where:** `backend/app/core/config.py:298-302` (declaration);
`backend/app/services/auth_service.py:526` (`status=UserStatus.ACTIVE`,
unconditional); `backend/app/api/v1/endpoints/auth.py:559-636`
(`register()` — issues tokens and logs the caller in immediately after
`register_user()` returns, with no approval gate in between).

**Failure scenario:** an operator sets `REGISTRATION_ENABLED=true` to allow
self-service signup — believing, on the strength of both the config
comment and the endpoint's own docstring, that `REGISTRATION_REQUIRES_
APPROVAL`'s default `True` means new accounts sit pending until an admin
approves them. In fact, the moment `POST /auth/register` returns 201, the
caller already holds valid access/refresh tokens for a fully `ACTIVE`
account with the baseline `member` role's permissions — no admin review
step exists anywhere in the code path. Anyone who can reach the endpoint
(rate-limited to 3/60s, but otherwise open) can self-provision an
authenticated account into a HIPAA-adjacent fire-department intranet with
zero vetting.

**Impact:** a documented access-control gate that a deployment would
reasonably rely on (it is `True` by default specifically so a department
turning on self-registration gets safe-by-default behavior) provides no
protection at all. Gated behind `REGISTRATION_ENABLED` (also `False` by
default), so this is latent unless an operator opts into self-registration
— but that is precisely the deployment shape the approval flag exists to
protect, and it silently does nothing there.

**Why flagged, not fixed:** closing this needs a real approval workflow —
at minimum a new `UserStatus` value (or a separate boolean/timestamp column)
representing "pending approval," a migration to add it, gating token
issuance and/or login on that state, and an admin-facing queue/action to
approve or reject a pending registrant (which may already partially exist
for a different flow — the members list — per the now-corrected note in
`docs/app-review/auth-session.md`, but was not verified to apply to
self-registration specifically). That is a product/design decision, not a
low-risk drive-by change to `config.py`/`database.py`/`security_
middleware.py`, and touches `auth_service.py`/`auth.py`/`models/user.py` —
outside this feature's own file scope. `docs/app-review/auth-session.md`'s
prior note on this ("honored server-side but no admin queue in the UI") was
itself factually wrong and has been corrected in the same change as this
finding. Mirrored to `docs/KNOWN_LIMITATIONS.md`.

### CI3-33-4 — LOW — Four more `config.py` settings have no reader anywhere in the backend — FLAGGED

**What:** an exhaustive per-field reference sweep of every `Settings` field
in `config.py` (160 fields; grepped for `\.NAME\b` across `app/`, `main.py`,
`scripts/`, `alembic/`, including self-references inside `config.py`'s own
methods) found, beyond CI3-33-3 above and the already-tracked
`REFRESH_ROTATION_GRACE_SECONDS` (`docs/KNOWN_LIMITATIONS.md`, tracked since
2026-08-12 — re-verified still accurate this pass, see below): `RATE_LIMIT_
PER_MINUTE`, `MAX_FILE_SIZE`, `STORAGE_TYPE`, and `DB_POOL_MIN` have zero
readers outside their own declaration. (`LDAP_*` is a separate,
already-documented case per CLAUDE.md: "exists in config but gates nothing
— LDAP is not implemented"; excluded here as not new.)

**Where:** `backend/app/core/config.py:53-61` (`DB_POOL_MIN`, declared
alongside `DB_POOL_MAX`, which _is_ read by `database.py:92`),
`config.py:306` (`RATE_LIMIT_PER_MINUTE` — the actual per-scope limits are
hardcoded in `security_middleware.py`'s `rate_limit_login()`/
`rate_limit_register()`/etc., and the separate `RATE_LIMIT_DEFAULT` string
_is_ read, by `main.py:56`), `config.py:832,834` (`STORAGE_TYPE`,
`MAX_FILE_SIZE` — `documents_service.py`/`documents.py` hardcode their own
`UPLOAD_DIR` string and size handling independently).

**Failure scenario:** an operator sets `RATE_LIMIT_PER_MINUTE=200` (it is
documented as a real option in `.env.example.full:148`) expecting to loosen
rate limiting for a busy legitimate deployment getting false 429s, or
`MAX_FILE_SIZE`/`STORAGE_TYPE` expecting to change upload behavior — none of
these has any effect. Unlike CI3-33-3, none of these gate an access-control
decision; they are tuning knobs that silently do nothing, which is
confusing but not a security weakening in itself (the actual, hardcoded
values are the ones actually enforced, not a laxer default the operator
accidentally left in place).

**Why flagged, not fixed:** wiring `RATE_LIMIT_PER_MINUTE` into the
existing six-plus hardcoded per-scope limits (login, register, password
reset, token refresh, password change, plus every `public_rate_limit()`
caller) needs a design decision on how a single global value should compose
with those — override, floor, or apply only to unlisted routes — which is
exactly the kind of behavior change this review's own rules reserve for an
owner decision. `MAX_FILE_SIZE`/`STORAGE_TYPE`/`DB_POOL_MIN` belong to the
file-storage and connection-pool-tuning domains respectively, outside this
feature's file scope. Mirrored to `docs/KNOWN_LIMITATIONS.md`.

**`REFRESH_ROTATION_GRACE_SECONDS` re-verified, not a new finding:** already
tracked in `docs/KNOWN_LIMITATIONS.md` since 2026-08-12 as an intentional
cleanup item — the grace window it once controlled was deliberately removed
on 2026-08-12 because the grace window was itself a replay-window
vulnerability (see `docs/app-review/auth-session.md`'s pass-3 note and
CHANGELOG 2026-08-12); the setting and the `user_sessions.previous_
refresh_token`/`previous_refresh_expires_at` columns are vestigial and
should eventually be dropped in a migration, but this is correctly LOW
priority, not a live security gap. Confirmed this pass: `config.py:156`
declares it, nothing reads it; `user.py:860-861` declares the two columns,
`auth_service.py:401-402` only ever sets them to `None`. Line-number
citations in the existing KNOWN_LIMITATIONS.md row had drifted (`config
.py:140`→`156`, `user.py:714`→`860`) and are corrected in this pass.

## Verified good ✅ (re-confirmed, no regression)

- **All 17 prior findings (CI-33-1/2/3, CI2-33-1 through 13) hold exactly as
  documented**, at current line numbers — see the re-verification table
  above.
- **`main.py`'s middleware stack** — pure ASGI throughout (grep for
  `BaseHTTPMiddleware` in `app/` still returns only the ban-documenting
  comments in `security_middleware.py`), registration order and every
  ordering comment unchanged from CI2-33/CI-33's description.
- **`config.py` read in full for the first time in this rotation's own
  words** (prior passes explicitly scoped it to spot-checked fix locations
  plus a `git diff` proof). Every `validate_security_config()` /
  `validate_cors_config()` branch, `get_trusted_hosts()`/`get_trusted_proxy_
networks()`/`is_trusted_proxy()`, the `COOKIE_SECURE`/`ALLOWED_ORIGINS`/
  `TRUSTED_HOSTS` field validators, and `__repr__`/`__str__`'s secret
  masking were read end to end. No new defect found in the validation logic
  itself — the two new findings (CI3-33-3/4) are both "declared, documented,
  never read" gaps in the field list, not bugs in the validators.
- **`Settings.__repr__`/`__str__` do not leak secrets bypassing the
  hand-written mask.** Confirmed no code in `app/`/`scripts/`/`main.py`
  calls `settings.model_dump()`/`settings.dict()`/`vars(settings)` (the
  three hits for `.model_dump(` in `organizations.py` are on unrelated
  per-org `email_settings`/`storage_settings`/`auth_settings` objects, not
  the global `Settings` instance) — so nothing bypasses the custom
  `__repr__`'s masking to serialize the raw field values.
- **`database.py`'s `_on_load_stamp_utc` event listener, `DatabaseManager`,
  `get_session()`/`get_db()`** — re-read in full, unchanged behavior from
  CI2-33's "new code reviewed fresh and found clean" verdict:
  `expire_on_commit=False` set exactly once, commit-or-rollback-and-close on
  every path, no leaked connection on the exception path.

## Schema & migration notes

n/a — no schema-touching code in this feature's scope. (CI3-33-4 notes that
`REFRESH_ROTATION_GRACE_SECONDS`'s eventual cleanup would need a migration
to drop the two vestigial `user_sessions` columns, but that is the existing
2026-08-12 LOW item, not new work from this pass.)

## Guard tests added

- `tests/test_security_middleware.py::TestRateLimiter::
test_an_active_lockout_survives_a_forced_eviction_triggered_by_another_key`
  (CI3-33-1) — verified to **fail** against pre-fix code (`assert 'attacker'
in {}`) and **pass** after the fix.
- `tests/test_security_middleware.py::TestRateLimiter::
test_a_calling_keys_own_history_survives_its_own_forced_eviction`
  (CI3-33-2) — verified to **fail** against pre-fix code (`assert 1 == 3`,
  and the 4th call that should be blocked was allowed) and **pass** after
  the fix.
- `tests/test_security_middleware.py::TestRateLimiter::
test_a_calling_keys_own_window_metadata_survives_its_own_forced_eviction`
  (CI3-33-1a) — verified to **fail** against the pre-follow-up code
  (`_key_windows["target"]` came back `None` immediately after its own
  call, and the key's still-valid history was then wiped by an unrelated
  short-window sweep) and **pass** after the fix.
- `tests/test_security_middleware.py::TestRateLimiter::
test_lockouts_are_capped_independently_of_requests` (CI3-33-1b) — verified
  to **fail** against the pre-follow-up code (500 distinct lockouts tracked
  against a cap of 100) and **pass** after the fix.
- `tests/test_security_middleware.py::TestRateLimiter::
test_lockout_cap_eviction_removes_soonest_expiring_first` (CI3-33-1b) —
  verified to **fail** against the pre-follow-up code (the two
  soonest-to-expire entries were not evicted, since no cap existed to evict
  them) and **pass** after the fix.
- `tests/test_security_middleware.py::TestRateLimiter::
test_a_calling_keys_own_active_lockout_survives_its_own_cap_eviction`
  (CI3-33-1b, self-eviction guard) — passes against both the pre-follow-up
  and fixed code (the pre-follow-up code has no `_MAX_LOCKOUTS` mechanism to
  exhibit this specific hazard in, so there is nothing for it to fail
  against; it stands as a regression guard against a future refactor
  reintroducing the self-eviction shape CI3-33-1b's fix specifically avoids
  for lockouts, the same role the analogous companion tests already play for
  `_key_windows`/`self.requests` elsewhere in this class).

All four bug-reproducing tests (CI3-33-1/2/1a and one of 1b's two) were also
demonstrated as real, exploitable bugs with standalone `python3`
reproductions (not just the pytest assertions) before being accepted as
findings, per this rotation's standing rule that a claimed defect must be
reproduced, not inferred from reading the code.

## Completion gate

| Check                                                                                                                                                                                                                                                                                    | Result                                                                                                                                             |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `flake8 app/ tests/ alembic/` (7.3.0, CI-pinned)                                                                                                                                                                                                                                         | ✅ 0 violations                                                                                                                                    |
| `black --check app/ tests/ alembic/` (26.5.1, CI-pinned)                                                                                                                                                                                                                                 | ✅ 1522 files unchanged                                                                                                                            |
| `isort --check-only app/ tests/ alembic/` (9.0.1, CI-pinned)                                                                                                                                                                                                                             | ✅ clean                                                                                                                                           |
| `python3 scripts/validate_migrations.py --strict`                                                                                                                                                                                                                                        | ✅ 435 revisions, single head `d3f8b6a24c91`, no schema change                                                                                     |
| Scoped tests (`test_security_middleware.py`, `test_core_infra_boot_checks.py`, `test_database_manager.py`, `test_database_url_encoding.py`, `test_onboarding_rate_limit_scopes.py`, `test_startup_diagnostics.py`, `test_tls_required_config.py`)                                        | ✅ 177 passed (was 171 in CI-33; +2 CI3-33-1/2, +4 CI3-33-1a/1b in the follow-up round)                                                            |
| Repo-tenancy guard suite (`test_endpoint_auth_coverage.py`, `test_require_permission_registry.py`, `test_scheduled_task_coverage.py`, `test_cron_org_loop_isolation.py`, `test_like_escaping.py`, `test_capacity_locking.py`, `test_csv_writer_sweep.py`, `test_org_scoping_ratchet.py`) | ✅ 63 passed                                                                                                                                       |
| Full backend suite (`pytest tests/`)                                                                                                                                                                                                                                                     | ✅ 11,725 passed, 21 skipped, 0 failed (all skips pre-existing: Docker unavailable, optional `pywebpush` dependency, opt-in API-contract suite)    |
| `tsc --noEmit` (bare, TS 5.9.3)                                                                                                                                                                                                                                                          | ✅ 0 errors (unchanged by the follow-up round — no frontend file touched)                                                                          |
| `npm run typecheck` (aliased TS 7.0.2, the actual build compiler)                                                                                                                                                                                                                        | ✅ 0 errors (unchanged by the follow-up round)                                                                                                     |
| `npx eslint .`                                                                                                                                                                                                                                                                           | ✅ 0 errors, 2 pre-existing warnings (`CallTypeChips.tsx`, `react-refresh/only-export-components`, unrelated — no frontend file touched this pass) |

**Sandbox note:** this worktree checkout had no `node_modules` of its own —
`npx`/`npm` commands were silently resolving hoisted packages from the parent
repo checkout's `node_modules` via Node's ancestor-directory walk, but
workspace-local packages that did **not** hoist to that root (`@types/node`)
were invisible. This made `npx eslint .` initially report **1,116** warnings,
all `@typescript-eslint/no-unsafe-*` on files importing `node:fs`/`node:path`
(15 existing guard-test files, e.g. `routeIntegrity.test.ts`) — not a real
regression from SEC-00 pass 3's "0 warnings" (2026-09-01), but the type-aware
parser falling back to unresolved/`any` types for Node built-ins with no
`@types/node` reachable. `npm install` from the worktree root (619 packages,
first install here) fixed it; verified byte-for-byte before/after on
`src/routeIntegrity.test.ts` (51 warnings → 0). `package-lock.json`'s
incidental normalization diff from that install (an npm-version metadata
artifact, no dependency changes) was reverted before committing — not part of
this change.
