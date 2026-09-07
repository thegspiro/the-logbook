# Security Review — Feature 33: Core Infrastructure (pass 3)

**Prefix:** `CI3` · **Iteration:** 33 · **Reviewed:** 2026-09-07 · **PR:** (opened this pass)

**Backend:** `app/core/security_middleware.py` (1,450 L → 1,672 L at PR
#2368's merge after four Codex-caught follow-up rounds → 1,605 L after PR
#2370's round-1 fixes plus its comment-chronology trim → 1,641 L after PR
#2370's round-2 (CI3-33-2c) fix → 1,638 L after PR #2370's round-3
structural refactor, CI3-33-2d — see the "Two sessions, one finding" note
below for the parallel 1,657 L short-circuit fix this superseded → 1,664 L
after PR #2370's round-4 (CI3-33-2e/2f), a bounded-saturation-map fix and a
second comment-chronology trim on the refactor's own new code),
`app/core/config.py` (1,041 L),
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
findings, all fixed). **7 new findings in `RateLimiter`, all fixed** (a
previously-undetected defect class shared with
`app/services/security_monitoring.py`'s tracker-cap logic, found
independently here): CI3-33-1/2 in the round opened as PR #2368; CI3-33-1a/1b
— Codex-caught gaps in those same two fixes, found on review of the open PR
and fixed in a follow-up round; CI3-33-1c — a second Codex round finding
CI3-33-1b's own fix was itself still incomplete, fixed by removing
by-size lockout eviction entirely rather than refining it further; and
CI3-33-1d/1e — a third Codex round finding `self._key_windows` itself grows
unbounded (the same defect class, in the third tracking structure) and that a
saturated-lockout-table violator's only remaining protection was `self.
requests`' much shorter sliding window rather than the lockout duration it
was told about. **2 dead config-switch findings, both flagged** — one HIGH
(an access-control gate with zero effect), one LOW (four minor tuning knobs).
All 17 prior findings re-verified still fixed, at current line numbers.

**Post-merge addendum (2026-09-07, PR #2370):** PR #2368 merged with two more
real Codex findings still open on `RateLimiter` — CI3-33-2a (P1, a
cross-scope saturation DoS) and CI3-33-2b (P2, a stale-capacity false
positive) — plus a comment-cleanup item, all fixed as a targeted follow-up.
See the CI3-33-2a/2b write-ups below (after CI3-33-1f) and PR #2370.

**Second post-merge addendum (2026-09-07, PR #2370):** review of PR #2370's
own commit found CI3-33-2c (P1) — CI3-33-2b's fix itself forced a full
three-dict sweep on _every_ request once the lockout table merely reached
capacity, a CPU-amplification DoS. This is round six on this class of code;
the "if a sixth round" trigger CI3-33-2a/2b's write-up set has been met,
and the judgment call is made explicitly in CI3-33-2c's own write-up: the
structural refactor is now recommended as the next piece of work on this
file, not indefinitely deferred. See CI3-33-2c below and PR #2370.

**Third post-merge addendum (2026-09-07, PR #2370):** review of CI3-33-2c's
own commit found CI3-33-2d (P1) — round seven, and a narrower version of
the exact CPU-amplification gap CI3-33-2c had just closed, this time
surviving one already-rejected key's own retries. The coordinator
authorized the structural refactor at this point rather than an eighth
incremental patch. `RateLimiter`'s `self.requests`/`self.lockouts`/
`self._key_windows` are now one `dict[str, _KeyState]`, paired with a
throttled (1-second) capacity-verification mechanism that closes CI3-33-2b,
2c, and 2d together rather than one at a time. See CI3-33-2d and "The
structural refactor" below, and PR #2370.

**Two sessions, one finding:** CI3-33-2d was found and fixed independently by
two concurrent Claude sessions on this same branch. A parallel session pushed
first with a narrower short-circuit fix (on the scope's own
`_saturation_reject_until`, "100 retries → 1 prune call") before this
session's structural refactor was ready to push; the resulting push rejection
was resolved by fetching and merging rather than force-pushing, keeping the
refactor (a verified superset that closes the same finding, and the rest of
the class, more thoroughly) as this branch's final state. The short-circuit
fix's own write-up is left below, unedited, as the record of what that
session found and shipped — see "CI3-33-2d (superseded commit)" immediately
following "The structural refactor" section, and
`docs/security-review/PROGRESS.md`'s "round 3b" entry for the full account.

**Fourth post-merge addendum (2026-09-07, PR #2370):** Codex reviewed the
merge commit that landed the structural refactor as this branch's final
state and left 4 new threads. Two were real findings against the refactor's
own new code, both fixed: CI3-33-2e (P1) — `self._saturation_reject_until`
had no size cap despite the merge's own comment claiming it "cannot be grown
by an attacker," true only because every _current_ call site passes a
literal scope, not because the interface enforces it — and CI3-33-2f (LOW,
comment-chronology) — several of the refactor's own docstrings restated the
CI3-33-1-through-2d review history inline rather than just the invariant,
the same anti-pattern CI3-33-2c's own cleanup had just removed elsewhere in
the file. The other two were verified, standalone, to already be closed by
the refactor and required no further change: a zero-`lockout_seconds`
retry-amplification variant of CI3-33-2d (moot — the refactor bounds the
expensive verification by a fixed 1-second, per-process throttle
independent of any caller's `lockout_seconds`, not by consulting
`reject_until` the way the now-superseded short-circuit fix did) and a
stale-capacity variant of CI3-33-2b (moot — `is_rate_limited` already
re-verifies capacity via the same throttled mechanism immediately before
deciding to extend the saturation signal, confirmed by a standalone repro
showing a fresh violator gets a real per-key lockout, not an extended
saturation fallback, once genuine capacity has freed up and the throttle
has elapsed). See CI3-33-2e/2f below and PR #2370.

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

**Fix (original, this pass — corrected below by CI3-33-1c):** a new,
independent `_MAX_LOCKOUTS` cap (10,000, matching `_MAX_KEYS`'s scale).
When `self.lockouts` exceeds it, `_evict_stale` evicted the
_soonest-to-expire_ entries first — not by request recency (which would
reintroduce CI3-33-1's mistake) and not by an arbitrary order: an entry
about to expire naturally anyway costs the least "early unlock" impact to
remove, while an entry expiring far in the future is the most valuable to
an attacker to have lifted early, so it was evicted last. The eviction gate
(`over_limit`) also triggers immediately when `self.lockouts` alone exceeds
its cap, not only when `self.requests` does. To avoid reintroducing
CI3-33-1's exact self-eviction hazard in a new form — a call evicting its
_own_ still-active lockout via its _own_ call's cap-eviction pass —
`is_rate_limited` also captured `self.lockouts.get(key)` before
`_evict_stale` ran and used that captured value (restoring the dict entry
if eviction removed it) rather than re-reading `self.lockouts[key]`
afterward, mirroring CI3-33-2's read-before/write-after-evict pattern for
lockouts as well as request history. Reproduced and verified against
pre-fix code (see Guard tests), including the self-eviction case
specifically (a key whose own lockout is the soonest-to-expire among an
over-cap tracker must still see itself as locked out).

**This fix was itself incomplete — see CI3-33-1c immediately below.** It
protected the _calling_ key's own lockout from self-eviction, but not an
_unrelated_ key's: any other key's active lockout could still be picked by
the by-expiry eviction and released early by someone else's call. The
by-expiry eviction mechanism described above was removed in the same
follow-up round that added CI3-33-1c; this section is left in place,
uncorrected in its own text, as the record of what this pass initially
shipped — CI3-33-1c documents what replaced it and why.

### CI3-33-1c — MED — CI3-33-1b's own fix could still release an unrelated key's active lockout early — ✅ FIXED (Codex review of PR #2368, round 2)

**What:** CI3-33-1b's by-expiry eviction of over-cap `self.lockouts`
protected the _calling_ key's own lockout via the read-before/write-after
capture, but that capture only covers the one key making the current call.
The eviction loop itself still picks from _every_ tracked lockout by
soonest-expiry, with no regard for whether the picked key is the one
calling `is_rate_limited` right now — so an entirely unrelated key's call
could trigger a sweep that evicts a _different_, genuinely active victim's
lockout.

**Where:** `backend/app/core/security_middleware.py`,
`RateLimiter._evict_stale` (the `_MAX_LOCKOUTS` by-expiry eviction block
CI3-33-1b added) and `RateLimiter.is_rate_limited` (the lockout-application
branch).

**Failure scenario:** `_MAX_LOCKOUTS`/`_MAX_KEYS` both at 3; "victim" is
genuinely locked out (expiring soonest among the tracked lockouts) and has
request history, but is not the key making the triggering call. An
unrelated key's call (`trigger-key`) forces the over-cap sweep on both
dicts: `self.lockouts["victim"]` is evicted (soonest-to-expire, and
`trigger-key`'s own read-before/write-after capture only protects
`trigger-key`'s own state, not victim's), and `self.requests["victim"]` is
separately evicted by the unrelated `_MAX_KEYS` mechanism in the same
sweep. Victim's very next request then finds neither a lockout nor request
history and returns `(False, None)` — not rate limited, in the middle of
what should have been an active 1800-second lockout. Reproduced exactly as
described (Codex's own repro, independently re-verified): with both caps
set to 3, an unrelated trigger removed `victim` from both dictionaries and
its immediate retry returned `(False, None)`.

**Impact:** the identical failure class CI3-33-1 was opened to fix —
silent early release of an active lockout — reachable again, this time at
`_MAX_LOCKOUTS` scale (a sustained flood of enough distinct locked-out keys
to saturate the new cap) instead of `_MAX_KEYS` scale, and against _any_
locked-out victim rather than only the calling key.

**Fix:** stopped evicting active lockouts for size, in any order, at all —
the direction Codex's review suggested and the one actually implemented
after confirming it was tractable, rather than settling for a flagged known
limitation. `_evict_stale`'s `_MAX_LOCKOUTS` by-expiry eviction block is
removed outright; the only way an entry now leaves `self.lockouts` is the
existing, always-safe `expired_lockouts` sweep (removes entries that have
genuinely expired — a state every reader already treats identically to
"not locked out"). The cap is enforced at _insertion_ time instead: when a
call trips the rate limit and would need to persist a _new_ lockout entry
(by this point in the method the key is guaranteed not to already hold an
unexpired one — the branch above already returned early if it did), the
write is skipped once `self.lockouts` is genuinely saturated with active
entries, rather than displacing an existing one to make room. The request
is rejected on this call regardless — the count-based check earlier in the
method already decided that on its own — and every subsequent request from
the same key keeps failing that same count-based check for as long as its
request history survives, a materially weaker but still real fallback,
rather than costing some _other_, unrelated victim their still-active
lockout. `self.lockouts` remains provably bounded at `_MAX_LOCKOUTS` (never
exceeds it, since insertion is gated), and — a strictly stronger guarantee
than CI3-33-1b's by-expiry scheme offered — once a lockout is persisted it
is _never_ evicted early for any reason, at any scale.

Reproduced (Codex's exact scenario) and verified to fail against the
pre-fix (CI3-33-1b) code before accepting; also verified directly that
under sustained saturation the first 100 attackers to be locked out (before
the table filled) keep their lockouts through 400 more distinct attackers
tripping the limit afterward.

### CI3-33-1d — MED — `self._key_windows` grows unbounded, independent of the two dicts it was supposed to track alongside — ✅ FIXED (Codex review of PR #2368, round 3)

**What:** `is_rate_limited` sets `self._key_windows[key] = window_seconds`
on _every_ call for that key — including a call made purely to retry
against an already-active lockout, which returns early on the lockout
check without ever writing `self.requests[key]`. Neither existing cleanup
path notices this: the individual stale-keys sweep and the forced
`_MAX_KEYS` eviction in `_evict_stale` both pop `self._key_windows[k]` only
as a side effect of popping `self.requests[k]`. A key that is only ever
locked out — never separately over its own request count within a single
call — therefore leaves a permanent `self._key_windows` entry the moment
it stops calling, with nothing to ever evict it.

**Where:** `backend/app/core/security_middleware.py`,
`RateLimiter.is_rate_limited` (the unconditional `self._key_windows[key] =
window_seconds` assignments) and `RateLimiter._evict_stale` (no cleanup
path independent of `self.requests`).

**Failure scenario:** 2,000 distinct attacker keys, each already locked
out, each making exactly one retry call against a `_MAX_KEYS=50` limiter.
`self.requests` correctly stays at 0 entries (these keys never get past
the lockout check). `self._key_windows` grows to all 2,000 — fully
unbounded by `_MAX_KEYS`, the exact CLAUDE.md Pitfall #9 shape, in the
third of the class's three tracking structures.

**Impact:** an in-memory tracker with no effective cap, reachable by any
sustained flood of distinct locked-out keys that keep retrying — the same
memory-exhaustion class CI3-33-1b/1c already fixed for `self.lockouts`,
rediscovered in `self._key_windows`.

**Fix:** an explicit orphan-cleanup step in `_evict_stale`, keyed on
`self.requests` alone (not `self.lockouts` — a first draft of this fix
conditioned removal on absence from _both_ dicts, which does nothing,
since `self._key_windows` is read in exactly one place, the stale-keys
comprehension, which only ever looks up a value for a key already present
in `self.requests`; a key present only in `self.lockouts` never has its
window consulted at all). Removes any `self._key_windows` entry whose key
is no longer in `self.requests`, regardless of recency — safe because,
unlike `self.lockouts`, a `self._key_windows` entry is not a security
decision, only a fallback for judging `self.requests[k]`'s own staleness.
`_evict_stale`'s `over_limit` gate also now includes
`len(self._key_windows) > self._MAX_KEYS`, forcing a prompt sweep if this
tracker alone spikes between the periodic 60s sweeps.

### CI3-33-1e — MED — A saturated-lockout-table violator's only remaining protection was `self.requests`' much shorter sliding window, not the configured lockout duration — ✅ FIXED (Codex review of PR #2368, round 3)

**What:** CI3-33-1c correctly stopped displacing an existing active
lockout to make room for a new one once `self.lockouts` is saturated — but
left the new violator with _no_ memory of the violation beyond
`self.requests`' own `window_seconds`, materially shorter than the
`lockout_seconds` they were told about ("Account locked for 30 minutes")
and, combined with `self.requests`' own separate `_MAX_KEYS` eviction, in
some cases shorter still.

**Where:** `backend/app/core/security_middleware.py`,
`RateLimiter.is_rate_limited` (the saturated branch of the "too many
requests" check, and the final "allowed" return path).

**Failure scenario:** lockouts table saturated (3 pre-existing active
entries, cap 3). A violator trips a 1800s (30-minute) lockout with
`max_requests=1`/`window_seconds=60` — rejected on this call, but the
lockout can't be persisted. 61 seconds later — past the 60s window, nowhere
near the 1800s lockout it was told about — the same violator's retry
returned `(False, None)`: not rate limited. Reproduced exactly as Codex
described.

**Impact:** during a saturation event (already, per CI3-33-1c, an extreme,
adversarial-scale condition — thousands of simultaneous active lockouts,
reachable only through this limiter's Redis-outage fallback), a violator
that has _already_ been correctly identified as exceeding its limit gets a
dramatically shorter effective punishment than every other violator the
system is simultaneously enforcing a real lockout against, for no reason
other than unlucky timing relative to the table filling up.

**Fix:** a new, single, bounded (`O(1)`) scalar,
`self._saturation_reject_until`, extended to `max(current, current_time +
lockout_seconds)` whenever a lockout can't be persisted due to saturation.
`is_rate_limited`'s final "allowed" path — reached only when
`filtered_requests` is empty, i.e. this call would otherwise be
indistinguishable from a fresh, no-evidence first-ever request — now fails
closed instead when `current_time < self._saturation_reject_until`: this
is precisely the shape a saturated-table violator's decayed history
produces, so it closes exactly the gap Codex demonstrated. A key with
_any_ live in-window history is completely unaffected (checked before this
branch is ever reached, on the normal count-based path), so this can only
ever make a request stricter than it would otherwise be, never looser.

**Deliberate, and worth stating plainly: this also rejects a genuinely
brand-new key's first-ever request while saturation is active**, not only
repeat violators whose history decayed — Codex's and the coordinator's own
framing explicitly sanctioned this ("rejecting new keys… is probably
tractable"), and no narrower per-key mechanism was found that closes
Codex's exact reproduction without reintroducing unbounded per-key state
(the same class of problem CI3-33-1b/1c/1d already fixed twice over — see
"On not doing a structural refactor this pass" below). This is a real,
sweeping availability tradeoff during an already-extreme event (thousands
of simultaneous active lockouts, Redis already down): a fire department's
own members making their first request of the fallback window during that
narrow combination would also be turned away for up to the scope's own
`lockout_seconds`. Deliberately does not persist any per-key state on this
reject path — it costs nothing beyond the one `O(1)` scalar, so it cannot
itself become a source of unbounded growth, and decays automatically once
`self._saturation_reject_until` passes with no new saturated insertions to
extend it.

### CI3-33-1f — comment accuracy only, no behavior change — obsolete "restore in case eviction removed it" narrative and dead write-back removed — ✅ FIXED (Codex review of PR #2368, round 3)

**What:** the `existing_lockout_expiry = self.lockouts.get(key)` capture at
the top of `is_rate_limited`, and the write-back inside the still-locked-out
branch below it, were still commented and coded as protecting against
`_evict_stale`'s by-size `_MAX_LOCKOUTS` eviction — but CI3-33-1c removed
that eviction path entirely two rounds ago. Not a functional bug (the
write-back was a no-op, not a wrong value), but a stale narrative describing
a code path that can no longer execute, which is exactly the kind of comment
that misleads the next reader into thinking eviction can still silently
remove an active lockout here.

**Where:** `backend/app/core/security_middleware.py`,
`RateLimiter.is_rate_limited`, immediately before and inside the
still-locked-out branch (the `existing_lockout_expiry` capture comment and
the `self.lockouts[key] = existing_lockout_expiry` write-back).

**Verified genuinely dead before removing anything**, per the coordinator's
explicit caution not to delete logic that might still be load-bearing for a
different reason: direct inspection of the current `_evict_stale` confirms
the _only_ remaining mutation of `self.lockouts` in that method is the
`expired_lockouts` sweep (`[k for k, v in self.lockouts.items() if now >=
v]`), which by construction can never select an entry this branch has just
confirmed is still unexpired (`current_time < existing_lockout_expiry`). So
the write-back could never have anything to restore by the time it ran.

**Fix:** removed the dead write-back line; rewrote the capture's comment to
state the real remaining reason it is still needed — `_evict_stale`'s
expired-lockouts sweep can independently clean up this exact key's entry
between calls (the periodic sweep, or a race with another key's call, may
notice the expiry first), and reading `self.lockouts.get(key)` only _after_
eviction would silently skip the request-history reset a few lines below
whenever that race was lost, since the entry would already be gone by the
time this method looked. No behavior change — confirmed by the full
`TestRateLimiter` suite (29/29) passing identically before and after this
specific edit, and by the fact that the only line removed was one that could
never execute a meaningful assignment.

**On not doing a structural refactor this pass.** This is the fourth
review round to find a real gap in this same interaction — three
independently-capped/evicted structures (`self.requests`,
`self.lockouts`, `self._key_windows`, now joined by one scalar) whose
per-key lifecycles are supposed to move together but keep drifting apart
under partial-write/partial-evict interactions. A single per-key record
(one dict keyed by `key`, holding `{requests, window, lockout_until}`)
would close this entire class of bug by construction — there would be
exactly one eviction/expiry path instead of several that can disagree with
each other — and is worth a deliberate follow-up pass. It was not
attempted here: every fix in this file lands mid-incident, verified
against a live Codex round rather than planned; 29 existing tests in
`TestRateLimiter` construct their scenarios by writing directly into
`self.requests`/`self.lockouts`/`self._key_windows`, so a representation
change means rewriting the whole class's test suite, not extending it,
which is a materially different (and materially riskier, done under this
kind of time pressure) unit of work than the incremental, individually-
reproduced-and-verified fixes in this file. CLAUDE.md's own standing
instruction for this rotation — "a wrong 'fix' in a security-middleware…
path is worse than an accurate finding" — argues for exactly this
trade-off: ship the four verified, narrowly-scoped fixes now, and treat
the redesign as its own reviewed, tested change rather than a fifth
same-PR patch. Recorded as a follow-up in
`docs/KNOWN_LIMITATIONS.md` rather than left only in this file.

**Addendum (2026-09-07, PR #2370):** PR #2368 merged with CI3-33-1e/1f's
comments still open — the merge landed roughly 50 seconds after Codex's
next round of review posted, before anyone had seen it — and that next
round turned out to be exactly the "fifth round" scenario this section
weighed. See CI3-33-2a/CI3-33-2b below for what it found and how it was
fixed as a targeted follow-up (PR #2370), and their own note on why the
structural refactor was, again, deliberately not attempted there either.

### CI3-33-2a — P1 — `_saturation_reject_until` was a single process-wide scalar shared by every rate-limit scope, not scoped to the one under attack — ✅ FIXED (Codex review of PR #2368, post-merge; fixed in PR #2370)

**What:** CI3-33-1e's `self._saturation_reject_until` is one scalar on the
shared `rate_limiter` instance — the same in-memory fallback object backing
`check_rate_limit()` (login, register, password-reset, token-refresh,
password-change) **and** every `public_rate_limit()` caller (public forms,
legal pages, display/calendar endpoints, webhooks). When `self.lockouts`
saturates because one scope is being flooded (e.g. an attacker driving login
lockouts during a Redis outage), the fix correctly made that scope's
violators fail closed — but the signal it set was global, so **every other
scope** sharing this process also failed closed for up to `lockout_seconds`
(≤30 minutes) for any client with no live in-window history in that other
scope.

**Where:** `backend/app/core/security_middleware.py`,
`RateLimiter.__init__` (the field's declaration) and `is_rate_limited` (both
the write, in the saturated branch of the "too many requests" check, and the
read, in the final "allowed" path).

**Failure scenario:** an attacker floods `login` lockouts until
`self.lockouts` saturates (3 pre-existing lockouts, cap 3, in the
reproduction). A brand-new key on a totally unrelated scope —
`pub_form_submit:9.9.9.9`, a public form submission with no history at all —
was rejected with "Account locked. Try again in 1800 seconds" purely because
`login`'s saturation event had set the one shared scalar. Reproduced
directly: with the login scope saturated, an unrelated `pub_form_submit`
key's first-ever request returned `is_limited=True`.

**Impact:** during a Redis outage under a login-flood attack — already the
exact condition this limiter's in-memory fallback exists to protect —
unrelated public forms, legal pages, calendar/display endpoints, and
webhooks across the entire application would fail closed for up to the
attacked scope's own lockout duration, for any client this process hadn't
already seen making a request in that scope. A single attacker flooding one
scope's lockouts could take down public-facing functionality across the
whole app — a self-inflicted, attacker-triggerable denial of service, and a
materially worse outcome than the gap CI3-33-1e closed.

**Fix:** `self._saturation_reject_until` is now `dict[str, float]`, keyed by
rate-limit _scope_ — the literal prefix each real caller puts before the
first `:` in its tracker key (`check_rate_limit` builds
`f"{scope}:{client_ip}"`; every `public_rate_limit()` call site builds its
key the same way, e.g. `f"pub_form_submit:{client_ip}"`). A new
`RateLimiter._scope_of(key)` helper extracts it by splitting on the first
`:` only (the identifier half can itself contain colons — an IPv6 address).
Confirmed by an exhaustive grep of every `check_rate_limit(..., scope=...)`
and `public_rate_limit(key=...)` call site in `app/`: the scope segment is
always a string literal written into the calling code, never derived from
request input — so this new dict cannot be grown by an attacker and needs no
size cap of its own (unlike `self.requests`/`self.lockouts`/
`self._key_windows`, all keyed by attacker-influenceable identifiers).
Reproduced and verified against pre-fix code (see Guard tests); also
verified the _same_-scope protection CI3-33-1e added is unaffected — a
saturated scope's own violators still fail closed past their own window.

### CI3-33-2b — P2 — a strict `>` eviction-gate comparison let a stale, already-expired lockout count trigger an unnecessary saturation rejection — ✅ FIXED (Codex review of PR #2368, post-merge; fixed in PR #2370)

**What:** `is_rate_limited`'s insertion decision
(`len(self.lockouts) < self._MAX_LOCKOUTS`) runs immediately after
`_evict_stale` returns in the same call — but `_evict_stale`'s own
`over_limit` gate used a strict `>` against `_MAX_LOCKOUTS`, so a table
sitting at _exactly_ capacity did not force an immediate sweep and instead
deferred to the normal ~60-second eviction throttle. If the most recent
periodic sweep happened recently, lockouts that expired since then stayed
counted, so a new violator's insertion decision read a stale, inflated
count and was treated as hitting a genuinely full table of active lockouts
when the real count was lower — in the reproduction, zero.

**Where:** `backend/app/core/security_middleware.py`,
`RateLimiter._evict_stale` (the `over_limit` gate's `self.lockouts` term).

**Failure scenario:** `_MAX_LOCKOUTS=3`, three lockouts all already expired
(`expiry = now - 10`), and a recent periodic sweep (`_last_eviction = now`)
so the ~60s throttle alone would otherwise block another one. A new
violator trips the limit: the stale `over_limit` gate (`3 > 3` → `False`)
skips the sweep, `self.lockouts` still reads as 3 (though all three are
dead), and `len(self.lockouts) < self._MAX_LOCKOUTS` (`3 < 3` → `False`)
treats the table as saturated — the violator's own lockout isn't persisted,
and (compounding with CI3-33-2a's bug at the time) the shared saturation
signal was extended for no reason. Reproduced directly, and verified to
fail against the pre-fix code (`git stash`).

**Impact:** a real but self-clearing lockout table could still trigger the
saturated-table fallback (weaker per-key protection, or — before CI3-33-2a
— a cross-scope DoS) even when it wasn't actually saturated, simply because
of unlucky timing relative to the last periodic sweep.

**Fix (original, this pass — corrected below by CI3-33-2c):**
`_evict_stale`'s `over_limit` gate now uses `>=` for the `self.lockouts`
term (the other two terms, `self.requests`/`self._key_windows` against
`_MAX_KEYS`, are unchanged — this bug is specific to the
immediately-following insertion decision, which only reads
`self.lockouts`). A table at exactly capacity now always forces this call's
sweep, which purges any lockouts that have genuinely expired since the last
sweep, before the insertion decision reads the count. Reproduced and
verified against pre-fix code (see Guard tests); also verified the fix
doesn't change behavior for the existing capping/eviction tests, all of
which run with `_EVICTION_INTERVAL = 0` (always sweeps regardless of this
gate) and were unaffected.

**This fix was itself incomplete — see CI3-33-2c immediately below.** It
correctly fixed the accuracy gap, but the mechanism it used — forcing
`_evict_stale`'s full three-dict sweep merely because `self.lockouts` sat
at capacity — meant **every** request sharing this limiter (not only the
one that needed an accurate answer) paid for a full sweep, for as long as
an attacker kept the table full: a CPU-amplification DoS. This section is
left in place, uncorrected in its own text, as the record of what this
round shipped; CI3-33-2c documents what replaced it and why.

**Comment cleanup (no behavior change):** the in-code comments across
`RateLimiter` had accumulated four rounds of PR numbers, finding IDs
(CI3-33-1a through 1f), Codex round numbers, and failed-attempt narratives —
useful as a record at review time, but a maintenance liability once a reader
has to reconcile source comments with review history to understand the
current code. Trimmed every comment in the class down to the invariant that
still matters (why an active lockout is never evicted early, why the
`_saturation_reject_until` signal is scoped and unbounded-safe, why the
eviction gate uses `>=` for lockouts, etc.); the incident chronology stays
in this file, which already has it in full. Verified no behavior changed:
the full `TestRateLimiter` suite passes identically before and after the
comment-only edits.

### CI3-33-2c — P1 — CI3-33-2b's own fix forced a full three-dict sweep on every request once the lockout table merely reached capacity — a CPU-amplification DoS — ✅ FIXED (Codex review of PR #2370, round 6)

**What:** CI3-33-2b changed `_evict_stale`'s `over_limit` gate to `>=` for
`self.lockouts`, so a table sitting at _exactly_ `_MAX_LOCKOUTS` forced an
immediate sweep rather than waiting for the normal ~60-second throttle.
That was correct as an accuracy fix for the one request that needed to know
the real count — but the gate is evaluated unconditionally at the top of
`is_rate_limited`, for _every_ call, regardless of whether that call is
anywhere near its own limit. Once an attacker drives `self.lockouts` to
exactly capacity — the steady state for the whole duration of a sustained
attack — every single subsequent request sharing this one process-wide
limiter (logins from other IPs, public form submissions, webhooks,
anything) triggered a full `O(_MAX_KEYS + _MAX_LOCKOUTS)` scan across
`self.requests`, `self.lockouts`, and `self._key_windows`.

**Where:** `backend/app/core/security_middleware.py`,
`RateLimiter._evict_stale` (the `over_limit` gate's `self.lockouts` term)
and `RateLimiter.is_rate_limited` (the insertion decision that actually
needed the accurate count).

**Failure scenario:** `_MAX_LOCKOUTS=3`, table filled with 3 genuinely
active lockouts (the sustained-attack steady state, not CI3-33-2b's stale-
count edge case). 200 distinct, unrelated keys — none anywhere near their
own limit, none attempting to insert a lockout — each make one call. Under
CI3-33-2b's fix, all 200 forced `_evict_stale`'s full sweep body to run
(confirmed by tracking whether `_last_eviction` actually advances past the
~60s throttle, not merely whether the method was called). Reproduced
directly, and verified to fail against the CI3-33-2b code (200 of 200
forced a full sweep) before accepting.

**Impact:** an attacker who fills the in-memory fallback table (this
limiter's exact Redis-outage failure mode) turns every request the
application receives, on any scope, into full-table-scan work — a
self-inflicted CPU-amplification denial of service triggered by, and
compounding, the exact outage condition this fallback exists to survive.
Materially worse than CI3-33-2b's own gap: that one degraded one violator's
protection; this one degrades every request's latency.

**Fix:** `_evict_stale`'s `over_limit` gate reverts `self.lockouts` to `>`
(matching `self.requests`/`self._key_windows`) — a safety net that should
structurally never fire, since insertion is gated and `self.lockouts`
should never exceed `_MAX_LOCKOUTS` in the first place. The accuracy need
CI3-33-2b actually had moves to a new, narrow `_prune_expired_lockouts()`
method — lockouts-only, not gated by `_EVICTION_INTERVAL` — called from
exactly one place: `is_rate_limited`'s insertion decision, and only when
`self.lockouts` is observed at or over capacity _at that decision point_.
This scopes the extra work to the one request that is actually about to
need an accurate answer, not every request that merely happens to find the
table full. The periodic three-dict sweep still cleans up expired lockouts
as a side effect in the normal course (unaffected by this change), so
`self.lockouts` isn't solely reliant on the targeted prune outside
saturation. Reproduced and verified against the CI3-33-2b code (see Guard
tests); also verified the genuine-saturation case (all-active lockouts at
cap) is unaffected — a new violator's own lockout still correctly fails to
persist, and no existing active entry is evicted to make room.

**On the structural refactor — this is now round six, and the earlier
"if a sixth round" trigger has been met.** CI3-33-1f (round 4) raised
considering the refactor after a fourth round; CI3-33-2a/2b's write-up
(round 5) explicitly named a sixth round of "this general shape" as the
threshold for treating it as a strong signal rather than a suggestion.
CI3-33-2c is that sixth round — and it is a direct regression introduced by
round 5's _own_ fix, in the exact same capacity-accuracy code path, which
is a materially stronger signal than "another dict disagreeing with
another dict": the fixes themselves are now generating the next round's
finding.

**Judgment call, stated explicitly rather than deferred again: the
refactor is now warranted, and should be the next piece of work on this
file — not indefinitely deferred, and not attempted inside this fix.**
Reasoning for not folding it into this commit: CI3-33-2c is a concrete,
verified regression the coordinator asked to be addressed with the same
rigor as every prior round (standalone repro, fail-before/pass-after test,
full completion gate), and mixing a representation-changing rewrite into
that same change is exactly the kind of scope creep that makes a fix
harder to verify, not easier — the reasoning CI3-33-1f and CI3-33-2a/2b
already gave for shipping narrow fixes under reactive pressure still holds
for the fix itself. What has changed is the recommendation for what
happens _next_: rather than "a follow-up design item" sitting in
`docs/KNOWN_LIMITATIONS.md` indefinitely, this pass upgrades that row to
recommend the refactor be scheduled as the very next piece of work touching
this class — before, not after, whatever the seventh round would otherwise
be. If another round of this general shape is found before the refactor
lands, that is no longer a data point to weigh; it is confirmation the call
made here was right.

**Update: it was found, immediately, on this exact fix.** CI3-33-2d
(immediately below) is round seven, found in review of this same commit —
confirming the call above rather than merely testing it. The refactor
described in this paragraph was not scheduled for later; it shipped as the
fix for CI3-33-2d. See "The structural refactor" section after CI3-33-2d
for what actually landed and why the coordinator authorized doing it now
rather than deferring again.

### CI3-33-2d — P1 — CI3-33-2c's own fix still let a single already-rejected key's retries repeatedly re-trigger the capacity scan — the seventh round of this defect class, and the trigger for the structural refactor — ✅ FIXED by structural refactor (Codex review of PR #2370, round 7)

**What:** CI3-33-2c correctly narrowed the forced capacity scan to only run
when the _current call_ needs to insert a lockout and the table is full —
but a key that is already over its own request limit and retrying
repeatedly re-enters that exact "needs to insert" branch on _every single
retry_, since its own lockout could never be persisted (the table stayed
saturated) and nothing distinguished "asking for the first time this
second" from "asking for the two-hundredth time this second." The narrowing
moved the CPU cost from "every request, from anyone" (CI3-33-2c's own bug)
to "every retry, from the specific key most likely to actually retry" — a
smaller blast radius, but not a closed one, and arguably the more
realistic attack shape of the two.

**Where:** `backend/app/core/security_middleware.py`,
`RateLimiter.is_rate_limited` (the `_prune_expired_lockouts()` call site)
and `RateLimiter._prune_expired_lockouts` itself.

**Failure scenario:** lockout table saturated with 3 genuinely active
entries; one already-rejected attacker key retries the same request 100
times in immediate succession (a realistic "hammer the endpoint" shape, not
a contrived one). Reproduced directly: all 100 retries each forced a fresh
`O(_MAX_LOCKOUTS)` scan in `_prune_expired_lockouts`, confirmed by tracking
real scan work (not merely call count) before accepting the finding.

**Impact:** an attacker who is already known to be over their own limit —
already the easiest and cheapest case to reject, needing nothing more than
the request-count check already computed a few lines earlier — could still
turn each of their own retries into full-table-scan work, for as long as
they kept retrying. A narrower version of CI3-33-2c's own CPU-amplification
concern, surviving inside the fix that closed the broader case.

**This is round seven of the same defect class**, and the sixth-round
trigger CI3-33-2a/2b's write-up set (see CI3-33-2c above) has now
unambiguously fired: not a new mechanism finding a new kind of gap, but the
_immediately preceding fix's own commit_ found to have a narrower version of
the _same_ gap it had just closed. The coordinator authorized the
structural refactor explicitly at this point, rather than a seventh
incremental patch — see "The structural refactor" below for what shipped.

## The structural refactor

Rounds one through seven (CI3-33-1 through 2d) all trace to the same root
cause, stated explicitly as early as CI3-33-1f (round 4) and reaffirmed at
every round since: `self.requests`, `self.lockouts`, and `self._key_windows`
were three independently-capped, independently-evicted dictionaries meant
to describe the same key's state, plus a saturation-accuracy mechanism
(`_prune_expired_lockouts` / the `>=` gate it replaced) bolted onto the
outside of that shape across rounds five through seven, trying to answer
"is the table really full" without a clean place to keep that answer
current. Every round's fix closed the specific gap found and, in three
separate instances (CI3-33-1a following CI3-33-2's fix, CI3-33-1c following
CI3-33-1b's, CI3-33-2c/2d following CI3-33-2b's), the fix itself introduced
the next round's finding in the same code path.

**What changed:** `backend/app/core/security_middleware.py`'s `RateLimiter`
now stores one record per key —

```python
@dataclass
class _KeyState:
    request_times: list[float] = field(default_factory=list)
    window_seconds: int = 60
    lockout_until: float | None = None
```

— in a single `dict[str, _KeyState]` (`self._keys`), replacing the three
separate dicts entirely. `self._saturation_reject_until` (CI3-33-2a's
per-scope dict) is unchanged and deliberately **not** folded into
`_KeyState`: it is keyed by rate-limit _scope_, a fixed, finite set of
string literals written into the codebase's own call sites, never by the
attacker-influenceable per-client `key` the other three structures used —
a fundamentally different key space, so collapsing it in would not close
any bug class, only add an unrelated axis to the same structure.

**Why this closes the whole class, not just CI3-33-2d specifically:** every
round from 1 through 2c/2d was some variant of "a key's state exists in one
structure but not another," or "a value cached in a fourth place drifts out
of sync with the structures it was supposed to summarize." With one record
per key, a key either has a `_KeyState` — in which case its request
history, its own window, and its lockout status are the _same object_ and
cannot desynchronize — or it has none. There is no longer a "restore the
window metadata" step to forget (CI3-33-1a), no "also pop the lockout"
step to get wrong in either direction (CI3-33-1/1b/1c), and no third
dict's orphaned entries to leak (CI3-33-1d).

**The capacity-accuracy problem (CI3-33-2b/2c/2d) needed a second, distinct
idea, not just the merge.** Collapsing the three dicts does nothing by
itself to answer "how many keys currently have an active lockout" cheaply
and accurately — that answer still requires either scanning every record
(expensive, the CI3-33-2c/2d shape) or maintaining a cached count that can
go stale (the CI3-33-2b shape). The fix pairs the merge with a **throttled
verification**, independent of and much shorter than the general periodic
sweep:

- `self._active_lockout_count`, an integer cache. Incremented immediately
  on every successful insertion (so a burst of distinct violators within
  one throttle window still sees each other's inserts). Corrected to an
  exact value only by the periodic sweep (`_sweep`, ~60s, matching the old
  `_EVICTION_INTERVAL`) and by a new, narrow `_refresh_active_lockout_count`
  — called only when the cached count already reads at or over capacity,
  throttled to at most once per `_LOCKOUT_VERIFY_INTERVAL` (1 second,
  independent of and far shorter than the 60-second sweep interval).
- Between refreshes, the cache can only ever be a stale **over**-estimate
  (an expired-but-not-yet-rediscovered lockout still counts against
  capacity) — never an under-estimate. This is the safe direction: it can
  cause an unnecessary saturation-fallback determination for up to 1
  second, but can never let the true `_MAX_LOCKOUTS` cap be exceeded.
- The 1-second throttle bounds the scan cost to a fixed per-second rate
  **regardless of who is asking** — the same over-limit key retrying
  hundreds of times (CI3-33-2d), or hundreds of different first-time
  violators arriving together (CI3-33-2c) — closing both shapes with the
  same mechanism, rather than trying to distinguish "which caller" the way
  CI3-33-2c's narrower scoping attempted and CI3-33-2d found the gap in.

**Forced eviction by `_MAX_KEYS`, unified.** The old design's "don't also
evict the lockout" step (CI3-33-1) becomes structural: the by-recency
eviction pool for `_MAX_KEYS` pressure excludes any record with an
unexpired `lockout_until` entirely — not just "removes the request history
but not the lockout" (the old fix's own careful two-part behavior), but
"does not consider this record for eviction at all." One consequence,
deliberate and now explicitly documented: total tracked keys can exceed
`_MAX_KEYS` by up to `_MAX_LOCKOUTS` worth of actively-locked-out records
that the by-recency mechanism is not permitted to touch — the same combined
bound the old three-dict design produced as a side effect, now stated as
policy rather than emerging from how three independent caps happened to
interact.

**Testing.** Every existing behavior the 33-test `TestRateLimiter` suite
locked in was read as a spec before writing a line of the new class (not
after) — what each test was actually verifying about `is_rate_limited`'s
externally-observable behavior, separate from how it happened to poke the
old three-dict internals to set up its scenario. All 33 tests were then
rewritten against the new `_KeyState`/`self._keys` shape (direct dict
manipulation replaced with `_KeyState(...)` construction; assertions like
`"key" in limiter.lockouts` replaced with `limiter._keys["key"].lockout_until
is not None`), and **passed on the first full run against the new class** —
no test needed a second round of fixing to match the refactor, which is
strong evidence the translation preserved intent rather than accidentally
relaxing what was being checked. Two tests were substantively repurposed
rather than 1:1-translated, because their old premise no longer applies
under the unified model:

- `test_max_keys_evicts_associated_lockouts` (old, near-tautological once
  request/lockout state can no longer split across dicts) became
  `test_max_keys_eviction_never_touches_an_actively_locked_out_key` — 6
  actively-locked-out keys under `_MAX_KEYS=3` pressure, asserting none are
  evicted, exercising the "excluded from the eviction pool entirely"
  behavior above.
- `test_key_windows_does_not_grow_unbounded_from_locked_out_retries` (old,
  a `self._key_windows`-specific leak that is now structurally impossible)
  became `test_key_count_stays_bounded_by_max_keys_plus_max_lockouts_under_locked_out_retries`
  — 2,000 distinct already-locked-out keys, each retrying once, asserting
  `self._keys` stays at exactly 2,000 (no growth from the retries) and
  within the documented combined bound.

Two new tests close CI3-33-2d specifically and the class more broadly:

- `test_round_7_retries_do_not_repeatedly_rescan_lockout_capacity` — the
  direct reproduction: 100 retries of one already-rejected key against a
  saturated table, both throttles pre-warmed to match a realistic
  steady-state attacker (not the first request the process has ever
  handled), asserting zero real scans occur among the 100, then that a
  fresh verification is still reachable once real time passes the
  throttle. Verified to fail against the CI3-33-2c/pre-refactor code
  (reproduced with a standalone script against that code's actual
  `_prune_expired_lockouts`, since the internal API changed too much for a
  literal before/after pytest run against both) and pass after.
- `test_fuzz_mixed_scopes_saturation_and_retries_keeps_internal_state_bounded`
  — a seeded, deterministic property-style test: 4,000 calls against a
  small pool of keys across 4 scopes, randomized request rates and forward-
  moving time, asserting throughout that `is_rate_limited`'s own return
  value never disagrees with the state it leaves behind (a "not limited"
  result never coexists with a still-active `lockout_until`), and at the
  end that `self._active_lockout_count` never _under_-counts the true
  active count (only ever over-counts, the safe direction), that
  `self._keys` stays within the documented `_MAX_KEYS + _MAX_LOCKOUTS`
  bound, and that `self._saturation_reject_until` never grows past the
  number of distinct scopes actually exercised.

`TestRateLimiter` is 35 tests (was 33 before this round: two repurposed as
above, two new). Full write-up of the `_last_lockout_verify`/
`_active_lockout_count` mechanics is in `_refresh_active_lockout_count`'s
own docstring in the source, which — per CI3-33-2c's own comment-chronology
cleanup — is where the _invariant_ belongs; this document is where the
_history of getting there_ belongs.

### CI3-33-2d (superseded commit) — P1 — CI3-33-2c's own scoping left an already-saturated key's retries each paying the full prune scan — ✅ FIXED, then superseded by the structural refactor above (Codex review of PR #2370, round 7)

**Two sessions, one finding.** This write-up is the record of a second,
concurrent Claude session's independent fix for the same round-7 finding
described above. Both sessions read the same Codex comment, reproduced the
same gap, and shipped a fix on the same branch at nearly the same time; the
other session's commit reached `origin` first, and this session's push was
rejected and then merged (not force-pushed) rather than clobbering it. The
structural refactor above — a verified superset that closes this finding and
the rest of the CI3-33-1-through-2d class by construction, not just this one
retry shape — is what actually landed as this branch's final state. This
section is left in place, unedited from how that session wrote it, as an
honest record of what was independently found and shipped, per this
rotation's standing convention for a superseded fix (see
`docs/security-review/PROGRESS.md`, "round 3b"). Its final paragraph below,
recommending the refactor stay a follow-up item, was overtaken by events: the
refactor is not a follow-up, it is what shipped.

**What:** CI3-33-2c correctly scoped the lockouts-only prune to only the one
call that is itself about to attempt an insertion — but did not distinguish
"the call that first discovers this scope is saturated" from "every later
retry from the same already-rejected key." Once a key is over its own limit,
`filtered_requests` never drops back below `max_requests` for it until its
own request history ages out of `window_seconds`, so every retry re-enters
the same insertion-attempt branch and repeats the full
`O(_MAX_LOCKOUTS)` `_prune_expired_lockouts` scan — for as long as the
attacker keeps retrying. The one call CI3-33-2c scoped the cost to is not
one call at all when the caller controls the retry rate; it is exactly as
many calls as the attacker chooses to make.

**Where:** `backend/app/core/security_middleware.py`,
`RateLimiter.is_rate_limited`, the insertion-attempt branch CI3-33-2c
introduced.

**Failure scenario:** `_MAX_LOCKOUTS=3`, table filled with 3 genuinely
active lockouts. A single already-over-limit key retries 100 times against
the same scope. Reproduced directly against the CI3-33-2c code: 99 of the
100 retries (all but the one that already recorded its first, unlimited
request) each independently ran the full prune scan — confirmed by counting
calls to `_prune_expired_lockouts` directly, not merely observing the
outcome.

**Impact:** narrower than CI3-33-2c (one key, one scope, not every request
sharing the process-wide limiter) but the same CPU-amplification shape, and
fully attacker-controlled: the retry loop itself is the amplifier, with no
rate limit of its own gating how often it can be paid.

**Fix (as originally shipped, before being superseded):** short-circuit on
this scope's own `_saturation_reject_until` before attempting the prune or
the capacity check at all. Once a call has already established the scope as
saturated (`current_time < reject_until` for that scope), a later call
within that window skips straight to extending the signal — the same
outcome the scope's saturation-reject fallback already promised this key, so
the short-circuit cannot make its protection any weaker. Verified the
short-circuit does not outlive `reject_until`: once it lapses, the next call
over its limit re-runs the accurate prune/capacity check rather than
treating the scope as saturated forever (guard test). Reproduced and
verified against the CI3-33-2c code (100 retries -> 1 prune call, all still
rejected) before accepting.

**On the structural refactor — round 7, and CI3-33-2c's own closing line
has now happened.** CI3-33-2c said explicitly: "if another round of this
general shape is found before the refactor lands, that is no longer a data
point to weigh; it is confirmation the call made here was right." This is
that round — a fix to the exact same insertion-attempt branch, found by
reviewing the fix that preceded it, for the fourth time running (CI3-33-1d/
1e, CI3-33-2a/2b, CI3-33-2c, now CI3-33-2d). _(As originally written, this
paragraph continued: "The refactor recommendation in
`docs/KNOWN_LIMITATIONS.md` is not changed further by this finding — it
already reads 'RECOMMENDED NEXT PRIORITY' — but this round is the
confirmation that row anticipated, not a new data point weighing toward it."
That recommendation was, in fact, acted on in the same round by the other
concurrent session — see "The structural refactor" above and
`docs/KNOWN_LIMITATIONS.md`, now marked Resolved.)_

### CI3-33-2e — P1 — `_saturation_reject_until` had no size cap or eviction, contradicting its own comment — ✅ FIXED (Codex review of PR #2370, round 8)

**What:** the structural refactor's `_saturation_reject_until` dict — kept
deliberately separate from `_KeyState` because it is scoped per rate-limit
_scope_, not per client key — had no maximum size and no eviction. Its own
comment argued this was safe because "scope prefixes are a fixed, finite
set of string literals written into the codebase's own call sites, never
derived from request input" — true of every call site as of this review
(confirmed by grepping every `check_rate_limit(scope=...)` and
`public_rate_limit(key=...)` call site in `app/`), but the two functions'
own signatures (`scope: str`, `key: str`) don't enforce that. Nothing stops
a future caller from building a scope dynamically, and Pitfall #9 in
`CLAUDE.md` requires every in-memory tracking structure to have a cap,
periodic eviction, and a fallback — a requirement the merge's own comment
argued its way out of rather than met.

**Where:** `backend/app/core/security_middleware.py`,
`RateLimiter.__init__` (`self._saturation_reject_until`) and `RateLimiter.
_sweep`.

**Failure scenario:** reproduced directly — 5,000 distinct dynamic scopes,
each driven through the saturation branch once, grew
`self._saturation_reject_until` to 5,000 entries with no cap and no
eviction, confirming the comment's safety claim held only by convention at
today's call sites, not by construction.

**Fix:** a new `_MAX_SATURATION_SCOPES` cap (1,000 — call sites number in
the dozens today, so this leaves generous headroom while still bounding
memory against a future dynamic-scope caller). `_sweep` — already the
mechanism that bounds `self._keys` — now also clears expired
`_saturation_reject_until` entries first (an expired `reject_until`
protects nothing, so removing it costs nothing) and, only if still over cap
after that, evicts the soonest-to-expire remaining entries: those are also
the ones closest to no longer mattering, so this loses the least
fail-closed protection per entry removed. `_sweep`'s own forced-sweep
trigger was extended to fire when `_saturation_reject_until` alone exceeds
cap, not only when `self._keys` does, so a scope-only flood cannot rely on
key-count pressure to ever trigger cleanup.

**Impact:** with no current call site building a scope dynamically, this
was latent — a defense-in-depth gap rather than an exploitable one today —
but is exactly the pattern CLAUDE.md's Pitfall #9 exists to catch before a
future caller (a per-integration or per-tenant scope, say) turns it live.

**Tests:** `test_saturation_reject_until_is_bounded_under_a_dynamic_scope_flood`
(the direct reproduction — verified to **fail** against the pre-fix code,
5,000 entries with no cap, and **pass** after, bounded to
`_MAX_SATURATION_SCOPES + 1`, the same one-call transient-overshoot
tolerance already established for `_MAX_KEYS` elsewhere in this suite) and
`test_sweep_clears_expired_saturation_entries_before_evicting_live_ones` (a
companion guard: 5 scopes saturate and expire almost immediately under a
cap of 5, then a 6th, genuinely live scope arrives after both the expiry
and the eviction throttle have passed — the 5 expired entries are swept,
not evicted-by-soonest, so the live entry never has to fight for room
against entries that no longer protect anything). `TestRateLimiter` is 37
tests (was 35).

### CI3-33-2f — LOW — review chronology restated inline in the refactor's own docstrings — ✅ FIXED (Codex review of PR #2370, round 8)

**What:** several of the structural refactor's new docstrings — `_KeyState`,
the `_LOCKOUT_VERIFY_INTERVAL` class comment, `_sweep`'s `_MAX_KEYS`
eviction comment, and `_refresh_active_lockout_count`'s docstring —
restated the CI3-33-1-through-2d review history inline ("the root cause
behind seven successive review rounds," "Two rounds of review found the
two ways to get this wrong") rather than only the invariant the code must
preserve. This is the same anti-pattern CI3-33-2c's own comment-chronology
cleanup removed elsewhere in this file, reintroduced by the refactor that
otherwise followed the convention this document states explicitly in its
"Testing" section above ("this document is where the history of getting
there belongs").

**Fix:** trimmed each of the four to state only the rationale/invariant a
future reader needs, with review history pointed at this document instead
of restated (`_KeyState`'s docstring now reads "See
docs/security-review/CI3-33-core-infra.md for the review history that led
to this shape" rather than narrating it). No behavior change — comment-only.

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
test_lockouts_are_capped_independently_of_requests` (CI3-33-1b/1c) —
  verified to **fail** against the CI3-33-1a code (500 distinct lockouts
  tracked against a cap of 100) and **pass** after the fix; assertion
  tightened from `<= cap + 1` to `<= cap` once CI3-33-1c made the bound
  exact.
- `tests/test_security_middleware.py::TestRateLimiter::
test_an_already_persisted_lockout_is_never_evicted_once_saturated`
  (CI3-33-1b/1c) — verified to **fail** against the CI3-33-1b code (some of
  the first 100 attackers, persisted before saturation, were later evicted
  by the by-expiry scheme) and **pass** after CI3-33-1c's fix.
- `tests/test_security_middleware.py::TestRateLimiter::
test_an_active_lockout_is_never_evicted_by_an_unrelated_keys_sweep`
  (CI3-33-1c) — the direct reproduction of Codex's second-round finding:
  verified to **fail** against the CI3-33-1b code (`assert 'victim' in
{'other-1': ..., 'other-2': ..., 'other-3': ...}`, i.e. victim's lockout
  was gone) and **pass** after the fix. Replaces the now-obsolete
  `test_lockout_cap_eviction_removes_soonest_expiring_first` and
  `test_a_calling_keys_own_active_lockout_survives_its_own_cap_eviction`
  from the CI3-33-1b round, which asserted behavior of the by-expiry
  eviction scheme CI3-33-1c removed.
- `tests/test_security_middleware.py::TestRateLimiter::
test_a_saturated_lockout_table_fails_closed_without_evicting_anyone`
  (CI3-33-1c) — verified to **fail** against the CI3-33-1b code (a new
  violator's lockout displaced one of three genuinely pre-existing active
  ones) and **pass** after the fix.
- `tests/test_security_middleware.py::TestRateLimiter::
test_key_windows_does_not_grow_unbounded_from_locked_out_retries`
  (CI3-33-1d) — 2,000 distinct locked-out keys each retrying once against a
  `_MAX_KEYS=50` limiter; verified to **fail** against the CI3-33-1c code
  (`len(limiter._key_windows) == 2000`, fully unbounded, while `self.requests`
  correctly stayed at 0) and **pass** after the fix (`_key_windows` bounded by
  `_MAX_KEYS`).
- `tests/test_security_middleware.py::TestRateLimiter::
test_a_saturated_table_violator_stays_rejected_past_its_own_window`
  (CI3-33-1e) — the direct reproduction of Codex's round-3 scenario, using
  `unittest.mock.patch("time.time", ...)` with strictly monotonic timestamps
  matching real call order; verified to **fail** against the CI3-33-1c code
  (`is_limited` came back `False` 61 seconds after a saturated-table
  rejection, despite the violator having been told "Account locked for 30
  minutes") and **pass** after the fix.
- `tests/test_security_middleware.py::TestRateLimiter::
test_saturation_fail_closed_does_not_affect_a_key_with_live_history` (CI3-33-1e)
  — a key with live in-window history, established before an unrelated
  violator triggers saturation, is unaffected by the new
  `_saturation_reject_until` check; passes both before and after (a
  non-regression guard for the fix's own stated scope limit, not a
  fail-before test).
- `tests/test_security_middleware.py::TestRateLimiter::
test_saturation_fail_closed_decays_once_the_window_passes` (CI3-33-1e) — a
  brand-new key is allowed again once `current_time` passes
  `_saturation_reject_until`, confirming the new scalar decays and does not
  become a permanent lockout of its own; passes both before and after (no
  such state existed pre-fix to fail against — this guards the new
  mechanism's own bound).

All bug-reproducing tests across all four rounds (CI3-33-1/2, CI3-33-1a,
CI3-33-1c, CI3-33-1d, CI3-33-1e, and the size-cap half of CI3-33-1b) were
demonstrated as real, exploitable bugs with standalone `python3`
reproductions (not just the pytest assertions) before being accepted as
findings, per this rotation's standing rule that a claimed defect must be
reproduced, not inferred from reading the code.

**Added in PR #2370 (post-merge follow-up):**

- `tests/test_security_middleware.py::TestRateLimiter::
test_saturation_reject_is_scoped_to_the_affected_rate_limit_scope`
  (CI3-33-2a) — the direct reproduction of the post-merge Codex finding:
  saturates the `login` scope's lockout table, then confirms an unrelated
  `pub_form_submit` key with no history is unaffected, and that the `login`
  scope's own saturation protection is unaffected. Verified to **fail**
  against the pre-fix (merged PR #2368) code (the unrelated scope was
  rejected: `assert True is False`) and **pass** after the fix.
- `tests/test_security_middleware.py::TestRateLimiter::
test_lockout_saturation_check_purges_expired_entries_first` (CI3-33-2b) —
  three already-expired lockouts filling the table to exactly
  `_MAX_LOCKOUTS`, with a recent `_last_eviction` timestamp so the periodic
  throttle alone would mask the stale count; a new violator's own lockout
  must persist normally, not be treated as saturated. Verified to **fail**
  against the pre-fix code (the violator's lockout was not persisted; the
  saturation-reject signal was extended for a table that was actually
  empty of active lockouts) and **pass** after the fix.

Both reproduced standalone with throwaway `python3` scripts before being
accepted as findings, matching the standing rule above. The three existing
CI3-33-1e tests referencing `_saturation_reject_until` were updated for the
scalar → per-scope-dict representation change (two needed scope-consistent
key names to keep testing same-scope behavior rather than trivially passing
via the new cross-scope isolation).

**Added in PR #2370 round 2 (CI3-33-2c):**

- `tests/test_security_middleware.py::TestRateLimiter::
test_saturated_lockout_table_does_not_force_a_full_sweep_for_every_request`
  (CI3-33-2c) — the direct reproduction: 200 distinct observer keys, none
  anywhere near their own limit, each make one call while `self.lockouts`
  sits at exactly `_MAX_LOCKOUTS` with genuinely active entries; none
  should force `_evict_stale`'s full sweep body to run. Detection uses a
  real (non-`NaN`) sentinel timestamp for `_last_eviction` before each call
  — a `NaN` sentinel was tried first and rejected, since `NaN` compared
  against anything is always `False`, which defeats the throttle condition
  itself (`now - _last_eviction < _EVICTION_INTERVAL` becomes `False`
  regardless of the fix under test) rather than correctly detecting whether
  the sweep body ran. Verified to **fail** against the CI3-33-2b code (200
  of 200 calls forced a full sweep) and **pass** after the fix (0 of 200).
- `tests/test_security_middleware.py::TestRateLimiter::
test_genuine_saturation_still_rejects_new_lockouts_without_evicting_existing`
  (CI3-33-2c companion guard) — with 3 truly active lockouts at cap, a new
  violator's own lockout still correctly fails to persist and no existing
  active entry is evicted; passes both before and after (a non-regression
  guard confirming the CPU-amplification fix didn't weaken CI3-33-2b's own
  protection, not a fail-before test in its own right).

Both reproduced standalone before being accepted; the `test_lockout_
saturation_check_purges_expired_entries_first` (CI3-33-2b) test's docstring
was updated to note its fix was itself superseded by the narrower
`_prune_expired_lockouts()` mechanism, without changing the test's own
assertions — the symptom it pins (a stale count must not cause a false
saturation rejection) is unaffected by which mechanism closes it, and the
test still passes unmodified against the CI3-33-2c code.

**Added/changed in PR #2370 round 3 (CI3-33-2d, structural refactor):** all
33 existing `TestRateLimiter` tests were read as a behavior spec and
rewritten against the new `_KeyState`/`self._keys` shape — see "The
structural refactor" section above for the two that were substantively
repurposed rather than 1:1-translated. The rewritten suite passed in full
on its first run against the new class (no second round of test-fixing was
needed to match the refactor). New tests:

- `tests/test_security_middleware.py::TestRateLimiter::
test_round_7_retries_do_not_repeatedly_rescan_lockout_capacity` (CI3-33-2d)
  — the direct reproduction: 100 retries of one already-rejected key
  against a saturated table, both throttles pre-warmed to a realistic
  steady state; asserts zero real scans among the 100 retries, then that a
  fresh verification is still reachable once real time passes the
  1-second throttle. Verified to **fail** against the pre-refactor
  (CI3-33-2c) code — via a standalone reproduction script against that
  code's actual `_prune_expired_lockouts` (100 of 100 retries forced a real
  scan), since the internal API changed too much for the same pytest test
  to run against both — and **pass** after.
- `tests/test_security_middleware.py::TestRateLimiter::
test_fuzz_mixed_scopes_saturation_and_retries_keeps_internal_state_bounded`
  — a seeded (deterministic), property-style test hammering one limiter
  with 4,000 calls across a small pool of keys in 4 scopes, randomized
  request rates and forward-moving mocked time. Asserts throughout that a
  "not limited" result never coexists with a still-active `lockout_until`
  on that key's own record, and at the end that `self._active_lockout_count`
  never under-counts the true active count (over-counting only — the safe
  direction), that `self._keys` stays within the documented
  `_MAX_KEYS + _MAX_LOCKOUTS` combined bound, and that
  `self._saturation_reject_until` never grows past the number of distinct
  scopes actually exercised (4). Not a fail-before/pass-after test in the
  usual sense (there is no equivalent internal-state assertion expressible
  against the old three-dict shape) — it is the class-level guard the
  coordinator asked for, verifying the _invariants_ the refactor claims to
  establish, at a scale and randomization no single hand-written scenario
  reaches.

Two existing tests were substantively repurposed (not merely renamed) for
the reasons given in "The structural refactor" above:
`test_max_keys_evicts_associated_lockouts` →
`test_max_keys_eviction_never_touches_an_actively_locked_out_key`, and
`test_key_windows_does_not_grow_unbounded_from_locked_out_retries` →
`test_key_count_stays_bounded_by_max_keys_plus_max_lockouts_under_locked_out_retries`.
`TestRateLimiter` is 35 tests (was 33 before this round).

**The other session's tests (superseded, not carried forward):** the
concurrent session's short-circuit fix (see "CI3-33-2d (superseded commit)"
above) added its own two tests —
`test_saturated_scope_does_not_repeat_full_prune_scan_on_retry` and
`test_saturation_short_circuit_re_checks_capacity_once_reject_until_lapses`
— both verified fail-before/pass-after against the CI3-33-2c code with the
same discipline as this round's tests. They were not merged into the final
suite: both assert against the three-dict internals
(`_prune_expired_lockouts` call counts, `_saturation_reject_until` as the
short-circuit signal) that the structural refactor replaced, so they do not
apply to the code that shipped. The equivalent behavior — a saturated
scope's retries do not repeat the full capacity scan — is what
`test_round_7_retries_do_not_repeatedly_rescan_lockout_capacity` above
verifies against the new `_KeyState` shape instead.

**Added in PR #2370 round 4 (CI3-33-2e):**

- `tests/test_security_middleware.py::TestRateLimiter::
test_saturation_reject_until_is_bounded_under_a_dynamic_scope_flood` — the
  direct reproduction: 5,000 distinct dynamic scopes each driven through
  the saturation branch once. Verified to **fail** against the pre-fix code
  (5,000 tracked entries, no cap) and **pass** after (bounded to
  `_MAX_SATURATION_SCOPES + 1`).
- `tests/test_security_middleware.py::TestRateLimiter::
test_sweep_clears_expired_saturation_entries_before_evicting_live_ones` —
  companion guard: expired entries are cleared before the soonest-to-expire
  eviction fallback runs, so a live entry never has to fight already-moot
  ones for room.

`TestRateLimiter` is 37 tests (was 35 before this round). CI3-33-2f
(comment-chronology cleanup) is comment-only and added no tests.

## Completion gate

The first table below reflects PR #2368's final (merged) state; the second
reflects PR #2370's state after its round-2 fix (CI3-33-2c); the third
reflects PR #2370's state after its round-3 structural refactor (CI3-33-2d):

| Check                                                                                                                                                                                                                                                                                    | Result                                                                                                                                                                        |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `flake8 app/core/security_middleware.py tests/test_security_middleware.py`                                                                                                                                                                                                               | ✅ 0 violations                                                                                                                                                               |
| `black --check` (both files)                                                                                                                                                                                                                                                             | ✅ clean (test file reformatted once by `black`, then re-verified)                                                                                                            |
| `isort --check-only` (both files)                                                                                                                                                                                                                                                        | ✅ clean                                                                                                                                                                      |
| `python3 scripts/validate_migrations.py --strict`                                                                                                                                                                                                                                        | ✅ 435 revisions, single head `d3f8b6a24c91`, unchanged — no schema change                                                                                                    |
| Scoped tests (`test_security_middleware.py`, `test_core_infra_boot_checks.py`, `test_database_manager.py`, `test_database_url_encoding.py`, `test_onboarding_rate_limit_scopes.py`, `test_startup_diagnostics.py`, `test_tls_required_config.py`)                                        | ✅ 184 passed (was 182 at PR #2368 merge; +2 for CI3-33-2a/2b — `TestRateLimiter` now 31 tests, was 29)                                                                       |
| Repo-tenancy guard suite (`test_endpoint_auth_coverage.py`, `test_require_permission_registry.py`, `test_scheduled_task_coverage.py`, `test_cron_org_loop_isolation.py`, `test_like_escaping.py`, `test_capacity_locking.py`, `test_csv_writer_sweep.py`, `test_org_scoping_ratchet.py`) | ✅ 63 passed                                                                                                                                                                  |
| Full backend suite (`pytest tests/`)                                                                                                                                                                                                                                                     | ✅ 11,732 passed, 21 skipped, 0 failed (was 11,730 at PR #2368 merge; skips all pre-existing: Docker unavailable, optional `pywebpush` dependency, opt-in API-contract suite) |

**After PR #2370's round-2 fix (CI3-33-2c), the gate was re-run:**

| Check                                                                      | Result                                                                                           |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `flake8 app/core/security_middleware.py tests/test_security_middleware.py` | ✅ 0 violations                                                                                  |
| `black --check` (both files)                                               | ✅ clean                                                                                         |
| `isort --check-only` (both files)                                          | ✅ clean                                                                                         |
| `python3 scripts/validate_migrations.py --strict`                          | ✅ 435 revisions, single head `d3f8b6a24c91`, unchanged — no schema change                       |
| Scoped tests (same 7 files as above)                                       | ✅ 186 passed (was 184 after round 1; +2 for CI3-33-2c — `TestRateLimiter` now 33 tests, was 31) |
| Repo-tenancy guard suite (same 8 files as above)                           | ✅ 63 passed                                                                                     |
| Full backend suite (`pytest tests/`)                                       | ✅ 11,734 passed, 21 skipped, 0 failed (was 11,732 after round 1; skips all pre-existing)        |

**After PR #2370's round-3 structural refactor (CI3-33-2d), the gate was
re-run in full — including the full backend suite, given the size of the
change (the coordinator's own instruction: "run the full completion gate...
before pushing given the blast radius"):**

| Check                                                                      | Result                                                                                                                                                                                                                                                                                                                                            |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `flake8 app/core/security_middleware.py tests/test_security_middleware.py` | ✅ 0 violations                                                                                                                                                                                                                                                                                                                                   |
| `black --check` (both files)                                               | ✅ clean (both files reformatted once by `black` after the initial write — a missing blank line and long lines — then re-verified)                                                                                                                                                                                                                |
| `isort --check-only` (both files)                                          | ✅ clean                                                                                                                                                                                                                                                                                                                                          |
| `python3 scripts/validate_migrations.py --strict`                          | ✅ 435 revisions, single head `d3f8b6a24c91`, unchanged — no schema change                                                                                                                                                                                                                                                                        |
| Scoped tests (same 7 files as above)                                       | ✅ 188 passed (was 186 after round 2; +2 for CI3-33-2d — `TestRateLimiter` now 35 tests, was 33; all 35 passed on the _first_ run against the rewritten class, no second round of test-fixing needed)                                                                                                                                             |
| Repo-tenancy guard suite (same 8 files as above)                           | ✅ 63 passed                                                                                                                                                                                                                                                                                                                                      |
| Full backend suite (`pytest tests/`)                                       | ✅ 11,736 passed, 21 skipped, 0 failed (was 11,734 after round 2; skips all pre-existing)                                                                                                                                                                                                                                                         |
| `python3 -m mypy app/core/security_middleware.py`                          | not part of this rotation's completion gate (844 pre-existing errors repo-wide, none introduced by this change) — checked anyway given the size of the refactor; the file's one hit (`HTTPConnection[State]` has no attribute `method`, an unrelated pre-existing line) was confirmed present, at a different line number, before this change too |

**After PR #2370's round-4 fix (CI3-33-2e/2f), the gate was re-run once more:**

| Check                                                                      | Result                                                                                           |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `flake8 app/core/security_middleware.py tests/test_security_middleware.py` | ✅ 0 violations                                                                                  |
| `black --check` (both files)                                               | ✅ clean (test file reformatted once by `black` after adding the 2 new tests, then re-verified)  |
| `isort --check-only` (both files)                                          | ✅ clean                                                                                         |
| `python3 scripts/validate_migrations.py --strict`                          | ✅ 435 revisions, single head `d3f8b6a24c91`, unchanged — no schema change                       |
| Scoped tests (same 7 files as above)                                       | ✅ 190 passed (was 188 after round 3; +2 for CI3-33-2e — `TestRateLimiter` now 37 tests, was 35) |
| Repo-tenancy guard suite (same 8 files as above)                           | ✅ 63 passed                                                                                     |
| Full backend suite (`pytest tests/`)                                       | ✅ 11,738 passed, 21 skipped, 0 failed (was 11,736 after round 3; skips all pre-existing)        |

No frontend file was touched in PR #2370 (any of its four rounds), so the
frontend checks below (last run at PR #2368's merge) are unchanged and were
not re-run:

_(The concurrent session's short-circuit commit was also gated before being
superseded — same 0-violation/clean/188-passed results, since both fixes
added 2 tests to the same file — but that gate run is not reproduced here a
second time; the table above, run against the code that actually shipped,
is definitive.)_

| Check                                                             | Result                                                                                                                                                                  |
| ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tsc --noEmit` (bare, TS 5.9.3)                                   | ✅ 0 errors                                                                                                                                                             |
| `npm run typecheck` (aliased TS 7.0.2, the actual build compiler) | ✅ 0 errors                                                                                                                                                             |
| `npx eslint .`                                                    | ✅ 0 errors, 2 pre-existing warnings (`CallTypeChips.tsx`, `react-refresh/only-export-components`, unrelated — no frontend file touched in any of the PRs in this pass) |

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
