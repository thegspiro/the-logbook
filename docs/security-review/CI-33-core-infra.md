# Security Review — Feature 33: Core Infrastructure (re-verification)

**Prefix:** `CI` · **Iteration:** 33 · **Reviewed:** 2026-08-31 · **PR:** [#2106](https://github.com/thegspiro/the-logbook/pull/2106) (round 1, merged), [#2107](https://github.com/thegspiro/the-logbook/pull/2107) (round 2)

**Note on PR split:** round 1 merged with its "0 new findings" conclusion
before Codex's review of that same PR — posted after CI went green —
was addressed, so round 2's fixes below landed as a separate follow-up
PR (#2107) rather than a push onto the already-merged #2106.

**Backend:** `app/core/security_middleware.py` (1,422 L → 1,447 L after this
pass), `app/core/config.py` (1,041 L), `app/core/database.py` (248 L → 254 L).
**Frontend:** none this pass.
**Migrations:** none.

This is the rotation's next scheduled look at Core Infrastructure, following
[`CI2-33-core-infra.md`](./CI2-33-core-infra.md) (2026-08-27, PR #1917 — 14
findings, all fixed). Round 1 (below) found the three in-scope files
byte-identical to that pass and re-verified all 14 prior fixes intact.
**Round 2 (Codex-caught)** then found 3 real bugs in code round 1 had
re-verified as correct, all now fixed — see below.

**3 new findings, all fixed. 1 known limitation carried forward. 1 scope
claim corrected.**

---

## Round 1 — zero code drift, all 14 prior fixes re-verified

`git diff` of PR #1917's close-out commit (`e05991a8`) against current `main`
was **empty** for all three in-scope files and for the four adjacent files
CI2-33 spot-checked (`security.py`, `cache.py`, `websocket_manager.py`,
`encrypted_types.py`). `main.py`'s middleware registration block was
byte-identical too.

## Scope

**Read in full:** `security_middleware.py` (all 1,422 lines, before round
2's additions), `database.py` (all 248 lines, before round 2's addition).

**`config.py`: not read in full this pass.** Round 1 verified the four
specific fixed locations (`ALGORITHM` boot check at `380–420`,
`AUDIT_LOG_SIGNING_KEY`/`CAPTCHA_ENABLED` warnings at `555–600`,
`TRUSTED_PROXY_IPS` CIDR-width check at `319`/`649–670`) plus confirmed the
whole file is byte-identical to CI2-33's full read via `git diff`. That is
sufficient to certify those specific fixes and the absence of any new code
in the file, but it is **not** the same claim as "read end-to-end this
pass" — the original wording here conflated the two (Codex, PR #2106). No
part of `config.py` outside the four verified locations was read this pass;
its correctness rests entirely on CI2-33's original full read plus the
git-diff proof that nothing has changed since.

**Confirmed unchanged, not re-read line-by-line a second time:**
`security.py`, `cache.py`, `websocket_manager.py`, `encrypted_types.py` —
`git diff` against the CI2-33 close-out commit is empty for all four.

**Not touched this pass:** same as CI2-33 — this feature's scope is the
middleware/config/database layer, not `audit.py` or `permissions.py`, which
are reviewed under their own rotation features (28, 02).

## Re-verification of CI2-33's 14 findings

Each one checked against the live file at the cited location, not assumed
from the prior write-up:

| id         | fix                                                                                                                                                                                      | still present?                                                                                                                             |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| CI2-33-1   | `SecurityMonitoringMiddleware` reads `request.state.authenticated_user` **after** `self.app()` returns (`security_middleware.py:1358–1365`)                                              | ✅                                                                                                                                         |
| CI2-33-2   | `RateLimiter._evict_stale` judges each key's staleness against its own recorded `_key_windows[k]`, not the sweep's trigger window (`:58–104`)                                            | ✅ (see CI-33-2 below — a second, distinct defect in the same class was found this pass)                                                   |
| CI2-33-3   | `database.py` `connect()` re-raises only the password-scrubbed detail on total failure (`:168–180`)                                                                                      | ✅                                                                                                                                         |
| CI2-33-4   | `config.py:388–392` boot check rejects any `ALGORITHM` other than `"HS256"`                                                                                                              | ✅                                                                                                                                         |
| CI2-33-5   | `config.py:596–598` warns when `AUDIT_LOG_SIGNING_KEY` is unset, mirroring `VOTE_SIGNING_KEY`                                                                                            | ✅                                                                                                                                         |
| CI2-33-6   | `config.py:562–587` warns on `CAPTCHA_ENABLED` with an empty/mismatched secret                                                                                                           | ✅                                                                                                                                         |
| CI2-33-7   | `IPLoggingMiddleware` only reuses an incoming `X-Request-ID` that matches `_REQUEST_ID_RE` (16 lowercase hex), else generates one (`security_middleware.py:1149`, `:1186–1191`)          | ✅                                                                                                                                         |
| CI2-33-8   | `config.py:414–416` warns when a `TRUSTED_PROXY_IPS` entry's `prefixlen` is below `_min_prefix`                                                                                          | ✅                                                                                                                                         |
| CI2-33-9   | `InputSanitizer.sanitize_string` HTML-escapes **before** truncating, and trims a partially-cut trailing entity (`security_middleware.py:304–320`)                                        | ✅                                                                                                                                         |
| CI2-33-10  | onboarding CSRF bypass is an anchored `request_path.startswith("/api/v1/onboarding")`, not a substring match (`:817–819`)                                                                | ✅                                                                                                                                         |
| CI2-33-11  | `DatabaseManager.is_connected` is a computed property; `disconnect()` sets both underlying fields to `None`                                                                              | ✅ but "structurally cannot go stale" was overstated — see CI-33-3 below                                                                   |
| CI2-33-12  | `InputSanitizer.validate_url` rejects a bare IPv4-literal host (`security_middleware.py:425–432`)                                                                                        | ✅                                                                                                                                         |
| CI2-33-13  | request-body buffering for the never-implemented injection-detector is gone; `SecurityMonitoringMiddleware`'s docstring states plainly that no such analysis runs (`:1260–1266`)         | ✅ — but the `EXPORT_ENDPOINTS` exact-match gap it inherits from the prior fix was omitted from this doc; carried forward explicitly below |
| CI-9/CI-10 | prior module-audit residual ops/design items (TLS posture, `optimize_image` fail-open, Redis `CERT_NONE`, no cache tenant namespacing, WS accept-before-auth, MFA recovery-code entropy) | re-confirmed accurate, still open by design — not re-flagged, per CI2-33                                                                   |

`main.py`'s middleware stack order is unchanged from CI2-33 and still
matches every ordering comment in the middleware classes themselves.

## Round 2 (Codex-caught) — 3 fixed, all verified against actual code

Round 1's "0 new findings" was wrong. Codex reviewed round 1's commit and
found three real defects that round 1's re-verification had certified as
correct without exercising the actual failure path — the code it cited was
real, but the behavior in a specific edge case was not the one the
citation implied.

**CI-33-1 (P1) — a zero-second lockout resets the whole rate-limit window,
not just the cool-down.**

**What:** `RateLimiter.is_rate_limited`'s lockout-expiry branch
unconditionally ran `self.requests.pop(key, None)` once
`current_time >= self.lockouts[key]`. For a real lockout
(`lockout_seconds` in the hundreds/thousands, e.g. 1800s) that's harmless —
by the time it expires, every recorded timestamp already predates the
window and the subsequent window filter would drop them anyway. But
`public_rate_limit()`'s in-memory Redis-outage fallback is called with
`lockout_seconds=0` from most of its public call sites (`calendar.py`,
`legal.py`, `display.py`'s calendar/legal/display routes, the PayPal and
Salesforce and generic integrations webhook receivers,
`finance_approvals.py`) — `rate_limiter.is_rate_limited(...,
lockout_seconds=lockout_seconds)` then sets
`self.lockouts[key] = current_time + 0`, which reads as "expired" on the
very next call.

**Where:** `backend/app/core/security_middleware.py` — the lockout-expiry
branch inside `RateLimiter.is_rate_limited`.

**Failure scenario:** during a Redis outage, an attacker floods any of the
seven public endpoints above. The 6th request (for `max_requests=5`) trips
the "lockout" and is correctly rejected — but because `lockout_seconds=0`,
the 7th request finds the lockout already "expired," and the old code wiped
the entire request history rather than just clearing the lockout marker.
The attacker gets a full fresh 5-request allowance immediately, and the
cycle repeats: 5 requests through, 1 rejected, repeat — a rejection rate of
1-in-6 instead of an actual limit, on exactly the public, unauthenticated
surface this fallback exists to protect when the primary Redis-backed
limiter is down.

**Impact:** the rate limit is nominally enforced (every 6th request is
rejected) but provides no real throughput ceiling — an attacker sustains
~83% of unrestricted request volume against public form/calendar/legal/
webhook/finance-approval-token endpoints for the duration of a Redis
outage.

**Fix:** only clear the request history on lockout-expiry when
`lockout_seconds > 0` (a real lockout occurred). A real lockout still gets
the identical clean slate as before — its recorded timestamps are already
stale by the time the window filter runs a few lines later, so the pop was
redundant there. Guard test:
`tests/test_security_middleware.py::TestRateLimiter::
test_zero_lockout_does_not_reset_the_window` — verified to fail against
the pre-fix code (`[False]*5 + [True, False, False, False, False]` observed
vs. the fixed `[False]*5 + [True]*5`).

**CI-33-2 (P2) — a failed Redis EXPIRE after a successful INCR leaves the
daily-cap counter permanently stuck.**

**What:** `daily_cap_exceeded()` calls `INCR` then, only when
`count == 1`, calls `EXPIRE key 93600`. If the `EXPIRE` call itself fails
(the whole block is wrapped in one `try`, so this is caught by the same
`except Exception` that handles a fully-down Redis) the function returns
`False` for that one call — but the key is left in Redis with a count and
**no TTL**. Every later call increments the same un-expiring key; once the
count exceeds `limit` it stays blocked, and unlike every other UTC-day
scope it never resets at midnight, because there is no TTL left to expire
it.

**Where:** `backend/app/core/security_middleware.py`, `daily_cap_exceeded`.

**Failure scenario:** a scope near its daily cap (e.g. a public form's
submission cap, or the guest-check-in daily cap CLAUDE.md Pitfall #27
documents) hits this exact INCR-succeeds/EXPIRE-fails race once. From that
point on, every legitimate submission to that scope is denied — not just
for the rest of that UTC day (the documented, intended behavior) but
indefinitely, until an operator manually deletes the Redis key. This is a
silent, self-inflicted denial-of-service on a public intake surface, not an
attacker's action.

**Fix:** when `count != 1` (not the first increment), check `TTL(key)`; if
it's `< 0` (no expiry), self-heal by issuing `EXPIRE` again. Costs one extra
Redis round-trip only on the already-incremented path, not on every call.
Guard tests (`TestDailyCapExceeded` in `test_security_middleware.py`):
`test_self_heals_a_ttl_lost_to_a_transient_expire_failure` (verified to fail
against the pre-fix code), `test_does_not_re_expire_a_key_that_already_has_a_ttl`,
`test_first_increment_still_sets_the_ttl_directly`.

**CI-33-3 (P2) — `DatabaseManager.disconnect()` left stale state on a
failed `dispose()`.**

**What:** CI2-33-11's original claim was that `is_connected` "structurally
cannot go stale" because it's a computed property over `self.engine`/
`self.session_factory`, and `disconnect()` sets both to `None`. True only
on the success path: `disconnect()` was `if self.engine: await
self.engine.dispose(); self.engine = None; self.session_factory = None`
with no exception handling — if `dispose()` itself raised, execution never
reached the two assignments, and `is_connected` kept reporting `True` for a
connection whose underlying engine had just failed to close cleanly.

**Where:** `backend/app/core/database.py`, `DatabaseManager.disconnect`.

**Failure scenario:** a shutdown-time `dispose()` failure (a hung
connection, a driver-level error) leaves `database_manager.is_connected ==
True` for an engine that is no longer usable and was never replaced — any
later code trusting that property (a health check, a
reconnect-if-not-connected guard) is misled into believing the database
layer is fine.

**Fix:** wrap `dispose()` in `try/except/finally` — reset `self.engine`/
`self.session_factory` to `None` in `finally` regardless of outcome, and
still log-and-re-raise the disposal error so it isn't silently swallowed.
Guard test:
`tests/test_database_manager.py::TestDisconnectResetsConnectionState::
test_state_is_reset_even_when_dispose_raises` (verified to fail against the
pre-fix code).

All three verified to fail against the pre-fix code (via `git stash` on the
two source files with the new tests in place) before being accepted as real
— per this rotation's standing rule that Codex findings get verified, not
assumed.

## Known limitation carried forward (not a new finding)

**`EXPORT_ENDPOINTS`'s exact-match gap still excludes one real export
route.** CI2-33's "Revised after Codex review" section already documented
this and left it unfixed by design: `training_programs.py`'s
`/programs/{program_id}/export` (mounted at
`/api/v1/training/programs/programs/{program_id}/export`) takes a path
parameter, so no fixed string in `SecurityMonitoringMiddleware
.EXPORT_ENDPOINTS` can match it — `detect_data_exfiltration` still never
runs for training-program exports. Closing this needs a prefix/pattern
match rather than the current exact-match set, which CI2-33 correctly
scoped as a larger change than that fix. Restating it here explicitly
(Codex, PR #2106) so it isn't read as newly-absent from this rotation's
state just because this doc's table didn't repeat it. Mirrored into
`docs/KNOWN_LIMITATIONS.md`.

## Verified good ✅ (re-confirmed, no regression)

- **13 of CI2-33's 14 fixes hold exactly as documented**; the 14th
  (CI2-33-11) holds on the success path, with the failure-path gap now
  closed by CI-33-3.
- **No new middleware, config flag, or database code path was added**
  before round 2 — round 1's `git diff e05991a8..origin/main` was empty for
  every file in this feature's scope.
- **Guard tests exist and pass**: all 7 scoped test files, 171/171 passed
  (166 at round 1, +5 from round 2's three fixes).

## Findings

Summary: **CI-33-1 (P1, fixed)**, **CI-33-2 (P2, fixed)**, **CI-33-3 (P2,
fixed)** — full writeups above. **`EXPORT_ENDPOINTS` gap** — pre-existing,
flagged, carried forward (not fixed this pass, per CI2-33's own scoping).

## Schema & migration notes

n/a — no schema-touching code in this feature's scope.

## Guard tests added

- `tests/test_security_middleware.py::TestRateLimiter::test_zero_lockout_does_not_reset_the_window` (CI-33-1).
- `tests/test_security_middleware.py::TestDailyCapExceeded` — 3 tests (CI-33-2).
- `tests/test_database_manager.py::TestDisconnectResetsConnectionState::test_state_is_reset_even_when_dispose_raises` (CI-33-3).

## Completion gate

| Check                                             | Result                                          |
| ------------------------------------------------- | ----------------------------------------------- |
| `flake8 app/ tests/ alembic/`                     | ✅ 0 violations                                 |
| `black --check app/ tests/ alembic/`              | ✅ clean                                        |
| `isort --check-only app/ tests/ alembic/`         | ✅ clean                                        |
| `python3 scripts/validate_migrations.py --strict` | ✅ 394 revisions, single head, no schema change |
| Scoped backend tests (same 7 files as CI2-33)     | ✅ 171 passed (was 166)                         |
| Full backend suite (`pytest tests/`)              | ✅ 9376 passed, 2 skipped, 0 failed             |
| `tsc --noEmit` / `eslint .`                       | n/a — no frontend file in scope, none changed   |
