# Security Review — Feature 33: Core Infrastructure (pass 3)

**Prefix:** `CI3` · **Iteration:** 33 · **Reviewed:** 2026-09-07 · **PR:** (opened this pass)

**Backend:** `app/core/security_middleware.py` (1,450 L → 1,672 L after four
Codex-caught follow-up rounds), `app/core/config.py` (1,041 L),
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

## Completion gate

| Check                                                                                                                                                                                                                                                                                    | Result                                                                                                                                                                 |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `flake8 app/ tests/ alembic/` (7.3.0, CI-pinned)                                                                                                                                                                                                                                         | ✅ 0 violations                                                                                                                                                        |
| `black --check app/ tests/ alembic/` (26.5.1, CI-pinned)                                                                                                                                                                                                                                 | ✅ 1522 files unchanged                                                                                                                                                |
| `isort --check-only app/ tests/ alembic/` (9.0.1, CI-pinned)                                                                                                                                                                                                                             | ✅ clean                                                                                                                                                               |
| `python3 scripts/validate_migrations.py --strict`                                                                                                                                                                                                                                        | ✅ 435 revisions, single head `d3f8b6a24c91`, no schema change                                                                                                         |
| Scoped tests (`test_security_middleware.py`, `test_core_infra_boot_checks.py`, `test_database_manager.py`, `test_database_url_encoding.py`, `test_onboarding_rate_limit_scopes.py`, `test_startup_diagnostics.py`, `test_tls_required_config.py`)                                        | ✅ 182 passed (was 171 in CI-33; +2 CI3-33-1/2, +4 CI3-33-1a/1b, net +1 in the CI3-33-1c round, +4 in the CI3-33-1d/1e round — `TestRateLimiter` now 29 tests, was 25) |
| Repo-tenancy guard suite (`test_endpoint_auth_coverage.py`, `test_require_permission_registry.py`, `test_scheduled_task_coverage.py`, `test_cron_org_loop_isolation.py`, `test_like_escaping.py`, `test_capacity_locking.py`, `test_csv_writer_sweep.py`, `test_org_scoping_ratchet.py`) | ✅ 63 passed                                                                                                                                                           |
| Full backend suite (`pytest tests/`)                                                                                                                                                                                                                                                     | ✅ 11,730 passed, 21 skipped, 0 failed (all skips pre-existing: Docker unavailable, optional `pywebpush` dependency, opt-in API-contract suite)                        |
| `tsc --noEmit` (bare, TS 5.9.3)                                                                                                                                                                                                                                                          | ✅ 0 errors (unchanged by the follow-up rounds — no frontend file touched)                                                                                             |
| `npm run typecheck` (aliased TS 7.0.2, the actual build compiler)                                                                                                                                                                                                                        | ✅ 0 errors (unchanged)                                                                                                                                                |
| `npx eslint .`                                                                                                                                                                                                                                                                           | ✅ 0 errors, 2 pre-existing warnings (`CallTypeChips.tsx`, `react-refresh/only-export-components`, unrelated — no frontend file touched this pass)                     |

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
