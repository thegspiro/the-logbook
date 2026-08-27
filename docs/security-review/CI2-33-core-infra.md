# Security Review — Feature 33: Core Infrastructure

**Prefix:** `CI2` · **Iteration:** 33 · **Reviewed:** 2026-08-27 · **PR:** (pending)

**Backend:** `app/core/security_middleware.py` (1,380 L), `app/core/database.py`
(219 L), `app/core/config.py` (964 L).
**Frontend:** none this pass.
**Migrations:** none — no schema change.

The rotation table's file list for this feature also named `core/middleware.py`
— that file does not exist (only `security_middleware.py` does; the rotation
table entry was stale). Corrected in `PROGRESS.md`.

This area carries four prior passes (module audit iteration 24, app-review
`core-infra.md` passes 1-4) that fixed 8 findings and left several ops/design
decisions deliberately flagged (CI-9, CI-10 residual). Every one of those
passes explicitly noted `security_middleware.py` and `config.py` were
reviewed "for security invariants, not line-by-line" — this pass did that
line-by-line read for the first time, via four parallel background agents
(`security_middleware.py` split in half, `config.py` in full, `database.py`
in full plus a spot-check re-verification of the 6 fixable prior findings).

14 findings: 1 HIGH, 8 MED, 5 LOW — all fixed. The CI-9/CI-10 residual items
are re-confirmed accurate and **not** re-flagged (see Verified good).

---

## Scope

**Read in full, by 4 parallel agents:** `security_middleware.py` (both
halves), `config.py` (all 964 lines, three passes), `database.py` (all 219
lines).

**Re-verified, not re-read line-by-line:** the 6 fixable prior findings
(CI-1/2/3/4/6/11) via targeted grep/read against their known fix locations;
the CI-9/CI-10-residual ops/design decisions, confirmed still accurately
described.

**Not touched this pass:** `security.py`, `cache.py`, `websocket_manager.py`,
`encrypted_types.py` — all covered by the prior module-audit/app-review
passes and spot-checked clean here, not re-read whole.

## Verified good ✅ (re-confirmed, no regression)

Spot-checked against the fix locations named in `docs/app-review/core-infra.md`:

- **CI-1** — `grep 'csv\.writer\('` across `backend/app/` → the only hit is
  `SafeCsvWriter`'s own implementation in `csv_export.py`.
- **CI-2** — `database.py`'s per-attempt retry log still scrubs `DB_PASSWORD`
  before logging (see CI2-33-3 below for the gap this pass found in the
  _other_ raise path).
- **CI-3** — `websocket_manager.py:30/46-48` — `MAX_CONNECTIONS_PER_ORG = 200`
  still enforced in `connect()`.
- **CI-4** — `encrypted_types.py:47-57,95-100` — both decrypt paths still
  narrow their `except` to `InvalidToken` only.
- **CI-6** — `security.py:771` — `options={"require": ["exp"]}` still present.
- **CI-11** — `security_middleware.py` — `raise_on_error=True` still present
  on both `check_rate_limit` fallback call sites, propagating correctly
  through `is_rate_limited()`'s except block to the in-memory fallback.
- **CI-9/CI-10 residual, unchanged and not re-flagged:** `optimize_image`
  fail-open, Redis `CERT_NONE` with no CA configured, no cache tenant
  namespacing, WebSocket `accept()` before auth, 40-bit MFA recovery codes.
  **One correction noted:** DB/Redis TLS is **no longer** WARN-only as
  originally flagged — `SECURITY_REQUIRE_TLS` now defaults `True` (CRITICAL
  by default, opt-out only via explicit `False`), matching
  `docs/KNOWN_LIMITATIONS.md`'s already-current "Partially resolved
  (2026-08-07)" note. No doc change needed; flagged here only because the
  instructions asked this pass to re-confirm it.

New code reviewed fresh and found clean:

- `get_client_ip()` correctly gates `X-Forwarded-For` trust on
  `settings.is_trusted_proxy(direct_ip)`, walks right-to-left skipping
  trusted hops, and defaults to _not_ trusting forwarded headers when
  `TRUSTED_PROXY_IPS` is empty.
- `RequestSizeLimitMiddleware`, `SecurityHeadersMiddleware`,
  `IPBlockingMiddleware`, `IPLoggingMiddleware` are all pure ASGI
  (`__call__(scope, receive, send)`), no `BaseHTTPMiddleware` (Pitfall #4);
  every wrapped `receive`/`send` callable is `async`.
- `CSRFProtection.validate_token` uses `secrets.compare_digest`
  (constant-time); the double-submit cookie logic itself has no bypass.
- `SecurityHeadersMiddleware`'s CSP has no wildcard sources and no
  `unsafe-eval`; HSTS, `X-Content-Type-Options`, `X-Frame-Options: DENY` all
  present.
- `database.py`: `expire_on_commit=False` is set exactly once, at the
  `async_sessionmaker(...)` call this file owns; no `isolation_level`
  override anywhere (confirms CLAUDE.md Pitfall #27's claim that this app
  runs InnoDB's untouched REPEATABLE READ default); `get_session()`/`get_db()`
  commit-or-rollback and always close, no leaked connection on the exception
  path.
- `config.py`'s secret masking (`__repr__`/`__str__`) covers every
  secret-bearing field, not just the four explicitly named — the rest are
  simply omitted from the hand-written repr rather than leaked through a
  pydantic default dump.
- `RateLimiter`'s `_MAX_KEYS` cap and forced-eviction-by-recency mechanics
  (Pitfall #9) are correct in isolation — CI2-33-2 below is about which
  _window_ eviction judges staleness against, not whether it happens.

## Findings

### CI2-33-1 — HIGH — Session-hijack and data-exfiltration monitoring never ran, for any request — ✅ FIXED

**What:** `SecurityMonitoringMiddleware` read `request.state.user` to identify
the caller, before `await self.app(...)` ran.

**Where:** `backend/app/core/security_middleware.py` (`SecurityMonitoringMiddleware.__call__`,
was lines 1256-1257 for the read, 1321/1357 for the two gated checks).

**Failure scenario:** two independent bugs, either one alone sufficient to
disable both checks entirely:

1. No auth path anywhere in the backend ever sets `request.state.user`.
   `get_current_user` (the real auth dependency) caches the resolved user as
   `request.state.authenticated_user` — a different attribute name.
2. Even with the right name, `request.state.authenticated_user` is set by a
   _route dependency_, which only runs **inside** `self.app(scope, ...)` —
   not before it. The session-hijack check read `user_id` before that call
   even for a correctly-named attribute; it could never have been populated
   at that point in the ASGI chain.

Net effect: `security_monitor.detect_session_hijack(...)` and
`security_monitor.detect_data_exfiltration(...)` — two of the four
capabilities the class's own docstring advertises — never ran for any
request, ever, with no exception, no log line, nothing to distinguish this
from working. This is CLAUDE.md Pitfall #19's shape ("a config switch must
have a reader") applied to a monitoring feature rather than a settings
toggle — exactly the kind of gap a compliance/audit review would reasonably
assume was covered given the class docstring. (Brute-force detection, wired
separately in `auth.py`, was not affected.)

**Impact:** a real session hijack or bulk data-exfiltration attempt against
this app generated **zero** alerts from this specific monitoring path for as
long as this bug existed.

**Fix:** removed the premature pre-request read. Both checks now run after
`await self.app(...)` returns, at which point `request.state.authenticated_user`
is genuinely populated for an authenticated route — read under its correct
name. Both checks are detection-only (never gate the response), so moving
the session-hijack check from pre- to post-response is a pure availability
fix, not a behavior change to request handling. Regression tests assert the
hijack check is called with the correct `user_id`/`session_id` for an
authenticated route, and is _not_ called at all for an unauthenticated one:
`tests/test_security_middleware.py::TestSecurityMonitoringMiddlewareReadsTheRealAuthenticatedUser`.

### CI2-33-2 — MED — The shared in-memory rate limiter evicted long-window keys using whichever window triggered the sweep — ✅ FIXED

**What:** `RateLimiter._evict_stale(now, window_seconds)` judged every
tracked key's staleness against the single `window_seconds` value passed by
whichever call happened to trigger the periodic sweep — not the window that
key was actually tracked under.

**Where:** `backend/app/core/security_middleware.py` (`RateLimiter._evict_stale`,
was lines 52-89).

**Failure scenario:** this one module-global `rate_limiter` instance is
shared across every scope that falls back to it from `check_rate_limit()` —
most use a 60-second window, but `users.py`'s `data_export` scope uses 3600
seconds (limit 3/hour). A sweep triggered by any 60s-window call would purge
a `data_export:{ip}` key the moment it had been quiet for **just over 60
seconds**, resetting its counter to zero — even though its real window
(3600s) had barely started. This limiter is only reached as a fallback
during a Redis outage (`check_rate_limit`'s `except` path) — precisely the
window where it's the _only_ protection left. During that window, an
attacker could exceed the intended 3-requests/hour data-export limit
indefinitely by spacing requests roughly 65+ seconds apart.

**Impact:** a rate limit silently weakened from "3 per hour" to
"effectively unlimited, one per ~65s," but only during a Redis outage — the
exact condition under which the limit matters most.

**Fix:** each key's `window_seconds` is now recorded (`_key_windows`) the
moment `is_rate_limited()` is called for it, before eviction runs, and
`_evict_stale` judges each key against its own recorded window rather than
the triggering call's. Regression tests construct the exact failure
scenario (a 3600s-window key quiet for 90s, swept by a 60s-window call) and
assert it survives, plus a companion test confirming it's still evicted once
its own window genuinely elapses:
`tests/test_security_middleware.py::TestRateLimiter` (three new tests).

### CI2-33-3 — MED — A total database-connection failure could leak the raw DSN (password) past the log-scrubbing this file already does — ✅ FIXED

**What:** `DatabaseManager.connect()`'s retry loop correctly scrubbed
`DB_PASSWORD` out of each attempt's **logged** warning (the original CI-2
fix) — but stored the raw, unscrubbed exception object in `last_exception`
and re-raised it as-is once retries were exhausted.

**Where:** `backend/app/core/database.py` (`connect()`, was lines 118-153).

**Failure scenario:** `database_manager.connect()` is called with **no
surrounding try/except** at its one call site (`main.py`'s `lifespan()`).
On total connection failure — e.g. a bad `DB_PASSWORD` causing every retry
attempt to fail with a driver error that embeds the DSN — the raw exception
propagates out of `lifespan()` to Uvicorn's startup-failure output and,
since `sentry_sdk.init()` runs at module load before `lifespan()`,
potentially into Sentry as a captured startup exception. This reopens
CI-2's exact leak class on a different path than the one CI-2 closed.

**Impact:** a credential leak to process logs/Sentry, specifically on the
one failure mode (total connection failure) an operator is most likely to
be looking at logs for.

**Fix:** the scrubbed detail computed for logging is now the _only_ thing
re-raised — a new `ConnectionError` carries the exception type and the
already-scrubbed message, raised `from None` so the raw original is never
attached as `__cause__`/`__context__` either. Regression tests assert the
raised exception's message never contains the raw password, and that no
cause chain leaks it either:
`tests/test_database_manager.py::TestConnectScrubsThePasswordOnTotalFailure`.

### CI2-33-4 — MED — The JWT `ALGORITHM` boot check only blocklisted null-signature spellings, not enforced the pinned value — ✅ FIXED

**What:** `validate_security_config()`'s algorithm check rejected only
`{"none", "None", "NONE", ""}`.

**Where:** `backend/app/core/config.py` (was lines 382-388).

**Failure scenario:** `decode_token()`'s allowlist is hardcoded to
`["HS256"]`, and tokens are signed with `settings.ALGORITHM`. Setting
`ALGORITHM` to anything not in that blocklist — a typo (`hs256`), a
different-but-real algorithm (`HS384`, `RS256`) — booted silently. Every
token minted after that boot would then be **rejected at verification**,
since `decode_token()` never accepts anything but `HS256`: a total,
unexplained authentication outage with no boot-time signal, directly
contradicting the invariant this repo documents ("anything but the pinned
HS256 must be rejected at startup") and the file's own adjacent comment.

**Impact:** a configuration typo silently breaks all authentication at
runtime instead of failing at boot where an operator would see it
immediately.

**Fix:** `if self.ALGORITHM != "HS256": CRITICAL`, replacing the blocklist
with the actual invariant. Regression tests cover the pinned value (no
warning), the null-signature case (still caught), and the previously-silent
gap (`HS384`, now caught):
`tests/test_core_infra_boot_checks.py::TestAlgorithmMustBeHS256`.

### CI2-33-5 — MED — `AUDIT_LOG_SIGNING_KEY` had no boot-time signal, unlike its sibling `VOTE_SIGNING_KEY` — ✅ FIXED

**What:** `AUDIT_LOG_SIGNING_KEY` — which signs the audit-log tamper-evidence
hash chain and the off-host shipping HMAC — falls back to `SECRET_KEY` when
unset, with the same "a dedicated key is strongly recommended" rationale
documented right next to `VOTE_SIGNING_KEY`. Only `VOTE_SIGNING_KEY` got a
production `WARNING`.

**Where:** `backend/app/core/config.py` (declared at lines 271-281; the
missing check was alongside the existing `VOTE_SIGNING_KEY` one, ~line 528).

**Failure scenario:** confirmed via `app/core/audit.py:50`
(`AUDIT_LOG_SIGNING_KEY or SECRET_KEY`) and `app/services/audit_ship_service.py:52-54`
that this key backs an ISO 27001 A.8.15 control: a dedicated key means an
attacker who compromises only SQL access to the audit table (and so can
write rows, but not read this key) cannot forge a valid tamper-evidence
chain. Left unset with no boot signal, a department could run indefinitely
believing that protection was live while it was actually riding on
`SECRET_KEY` — so an attacker who _also_ compromises `SECRET_KEY` (a
materially lower bar than compromising a key deliberately kept outside the
application database) can forge both auth tokens **and** the audit trail
that would otherwise prove tampering occurred.

**Impact:** the dedicated-key design silently defeated, with the same
"nobody knew to look" failure mode HIPAA §164.312(b) integrity controls
exist to prevent.

**Fix:** added the same `WARNING` treatment `VOTE_SIGNING_KEY` already gets.
Regression tests: `tests/test_core_infra_boot_checks.py::TestAuditLogSigningKeyIsWarnedLikeItsSibling`.

### CI2-33-6 — MED — `CAPTCHA_ENABLED=True` with an empty secret was only caught per-request, never at boot — ✅ FIXED

**What:** `app/core/captcha.py`'s `is_captcha_configured()` already treats
`CAPTCHA_ENABLED=True` + empty `CAPTCHA_SECRET_KEY` as "not configured" and
silently skips the challenge — logging only a per-request `logger.error()`.
No corresponding boot-time check existed.

**Where:** `backend/app/core/config.py` (settings declared at lines 257-264;
no check anywhere in `validate_security_config()`).

**Failure scenario:** an operator flips `CAPTCHA_ENABLED=True` (the abuse
control added after the 2026-08-16 red-team review) without also setting
`CAPTCHA_SECRET_KEY` — a fat-finger, not a deliberate choice. The app boots
clean. Every public form/password-reset/event-request submission from then
on skips the challenge entirely, and the only trace is a per-request error
log line nobody is watching for, while the operator believes the red-team
finding is closed.

**Impact:** an abuse control believed live is silently inert, with no
boot-time signal to catch the exact mistake that causes it.

**Fix:** `validate_security_config()` now warns when `CAPTCHA_ENABLED` is
True and `CAPTCHA_SECRET_KEY` is empty, mirroring
`is_captcha_configured()`'s own condition. Regression tests cover
enabled+empty (warns), enabled+set (silent), and disabled+empty (silent —
the pairing only matters once CAPTCHA is actually on):
`tests/test_core_infra_boot_checks.py::TestCaptchaSecretKeyPairing`.

### CI2-33-7 — MED — Unvalidated client-supplied `X-Request-ID` was interpolated verbatim into logs and a response header — ✅ FIXED

**What:** `request.headers.get("X-Request-ID") or generate_request_id()`
trusted an incoming request id with no format check, despite the class
docstring's claim it's "UUID4-hex."

**Where:** `backend/app/core/security_middleware.py`
(`IPLoggingMiddleware.__call__`, was line 1136).

**Failure scenario:** the value is bound into the loguru context for the
whole request, interpolated via f-string into two log lines, and echoed
into the `x-request-id` response header. A client sending e.g.
`X-Request-ID: 1\n2026-08-27 ERROR admin session revoked` could forge what
reads as a genuine, distinct entry in the security audit trail.

**Impact:** log-injection risk in the request-correlation id that every
request-level log line and the security audit trail both carry.

**Fix:** an incoming id is only reused when it matches the exact format
`generate_request_id()` produces (16 lowercase hex characters); anything
else falls back to a freshly generated one. Regression tests cover a
valid-format id (reused), an invalid one with embedded control characters
(replaced), and no incoming id (generated):
`tests/test_security_middleware.py::TestIPLoggingMiddlewareRequestIdValidation`.

### CI2-33-8 — LOW/MED — No sanity bound on `TRUSTED_PROXY_IPS` CIDR width — ✅ FIXED

**What:** `get_trusted_proxy_networks()` accepts any parseable CIDR with no
width check; only unparseable entries were logged.

**Where:** `backend/app/core/config.py` (was lines 576-608 for the parsing;
no boot-time check existed).

**Failure scenario:** a misconfigured `TRUSTED_PROXY_IPS=0.0.0.0/0` (or any
range wider than a real deployment's private network) causes
`get_client_ip()` to trust `X-Forwarded-For` from **any** direct-connecting
client within it, letting a direct-connecting attacker spoof their apparent
IP and bypass every IP-keyed control downstream (suspicious-IP throttle,
geo-blocking, rate-limit exemptions) — a valid-but-permissive entry gave no
signal that anything was wrong.

**Impact:** a single misconfigured environment variable silently defeats
several independent abuse controls at once, with no boot signal.

**Fix:** `validate_security_config()` now warns on any configured range
wider than `/8` (chosen so a typical `10.0.0.0/8` container network is
never flagged, while `0.0.0.0/0` and similarly broad ranges are). Regression
tests cover the overly-broad case (warns), the `/8` boundary itself (silent
— it's a legitimate common configuration), an exact IP, and no configured
range at all: `tests/test_core_infra_boot_checks.py::TestTrustedProxyRangeSanity`.

### CI2-33-9 — LOW — `InputSanitizer.sanitize_string` truncated before HTML-escaping — ✅ FIXED

**What:** `value = value[:max_length]` ran before `html.escape(value)`.

**Where:** `backend/app/core/security_middleware.py`
(`InputSanitizer.sanitize_string`, was lines 286-289).

**Failure scenario:** each escaped character (`&<>"'`) expands 3-5x, so the
**escaped** output could exceed `max_length` even though the pre-escape
input didn't — not an XSS bypass, but any caller trusting this function's
`max_length` as a true bound on stored/displayed length didn't get one, and
a later naive re-slice to `max_length` risked cutting an HTML entity
mid-sequence.

**Impact:** a length invariant callers reasonably assume this function
provides was silently not enforced.

**Fix:** escape first, then truncate the escaped result. Regression test
constructs an input whose escaped form would exceed `max_length` under the
old order and asserts the bound now holds:
`tests/test_security_middleware.py::TestInputSanitizer::test_sanitize_string_max_length_bounds_the_escaped_output`.

### CI2-33-10 — LOW — CSRF's onboarding bypass used a substring match instead of an anchored prefix — ✅ FIXED

**What:** `if "/onboarding/" in request_path or request_path.endswith("/onboarding")`.

**Where:** `backend/app/core/security_middleware.py` (`verify_csrf_token`,
was line 778).

**Failure scenario:** `IPBlockingMiddleware.BYPASS_PREFIXES` uses the
correct anchored form (`path.startswith("/api/v1/onboarding")`) for the
equivalent exemption. The substring form here would silently exempt any
_future_ endpoint whose path happens to contain `/onboarding/` or end in
`/onboarding` from CSRF protection — not exploitable against any route that
exists today (verified via grep), but a looser condition than the pattern
this codebase already uses correctly one class over.

**Impact:** latent — no route today matches the substring without also
matching the correct prefix — but an inconsistent, weaker pattern that
would silently widen the CSRF exemption the next time a route is added
with `onboarding` anywhere in its path.

**Fix:** anchored to the real router prefix,
`request_path.startswith("/api/v1/onboarding")`, matching
`IPBlockingMiddleware`'s existing convention. Regression tests cover the
real onboarding path (still exempt) and a path that merely contains the
substring (now correctly subject to the check):
`tests/test_security_middleware.py::TestVerifyCSRFTokenDependency` (two new
tests).

### CI2-33-11 — LOW — `disconnect()` left `is_connected` stale (True) after closing the connection — ✅ FIXED

**What:** `disconnect()` called `self.engine.dispose()` but never reset
`self.engine`/`self.session_factory` to `None`.

**Where:** `backend/app/core/database.py` (was lines 155-159).

**Failure scenario:** `is_connected` (`self.engine is not None and
self.session_factory is not None`) stayed `True` after a clean disconnect,
since both attributes still pointed at the disposed engine/stale factory.
No caller currently checks `is_connected` after calling `disconnect()`
(verified across `main.py`, `tests/conftest.py`, scripts), so this wasn't
reachable as a live bug — but it's a latent correctness trap for any future
reconnect-on-demand logic.

**Impact:** none today; a semantic trap for future code.

**Fix:** `disconnect()` now sets both attributes to `None`. Regression test:
`tests/test_database_manager.py::TestDisconnectResetsConnectionState`.

### CI2-33-12 — LOW/INFO — `InputSanitizer.validate_url` accepted bare IP-literal hosts — ✅ FIXED

**What:** the host-validation regex (`[a-zA-Z0-9.-]+`) matched a raw IPv4
address as readily as a domain name.

**Where:** `backend/app/core/security_middleware.py`
(`InputSanitizer.validate_url`, was lines 411-413).

**Failure scenario:** a raw IP host — especially an internal/link-local one
like `169.254.169.254` (a cloud metadata endpoint) — passed validation with
nothing downstream to catch it. This function has **no callers today**
(confirmed via grep; only referenced from `tests/test_security_middleware.py`),
so not currently exploitable. But if it's ever wired to a webhook/URL-fetch
feature on the assumption that "validated" means "safe to fetch," a raw IP
bypassing here would need its own SSRF check the caller might not think to
add.

**Impact:** none today (unused function); a gap that would matter the
moment this function gets a caller.

**Fix:** reject a bare IPv4 host literal after the existing format check.
Regression tests cover the rejection and confirm a domain with digit labels
(e.g. `192.example.com`) is not caught by the same check:
`tests/test_security_middleware.py::TestInputSanitizer` (two new tests).

### CI2-33-13 — MED — Injection-attempt detection was fully unimplemented; every write-request body was buffered into memory for nothing — ✅ FIXED (dead code removed, docstring corrected)

**What:** `SecurityMonitoringMiddleware`'s docstring claimed "Detect
injection attempts," and the code buffered up to 1MB of every
non-GET/HEAD/OPTIONS request body — including `/api/v1/auth/login` and
`/api/v1/users/password` — decoding and storing it in a `request_data["body"]`
dict that was never read again anywhere in the file. `SENSITIVE_ENDPOINTS`
was likewise defined and never consulted.

**Where:** `backend/app/core/security_middleware.py`
(`SecurityMonitoringMiddleware`, was lines 1210-1216, 1240-1247, 1260-1317).

**Failure scenario:** no injection analysis happened at all — the docstring
overclaimed a capability that was never implemented, and every login/
password-change request paid the memory-copy cost of buffering its body for
an analysis step that doesn't exist.

**Impact:** a compliance/audit reviewer reading the class docstring would
reasonably believe injection detection was covered; it never was. Real cost:
unnecessary per-request memory allocation on the app's most
security-sensitive endpoints.

**Fix:** removed the dead buffering, the unused `request_data`/
`SENSITIVE_ENDPOINTS`, and the now-orphaned `actual_receive`/`method`/`Any`
import — `self.app()` is called with the original `receive` directly, which
is byte-for-byte what the buffer-and-replay mechanism produced anyway once
nothing consumed the buffered copy. Corrected the class docstring to state
plainly that injection-attempt analysis is not implemented, rather than
silently dropping the claim. Implementing real detection (what patterns to
flag, false-positive tolerance, log-vs-block) is a product decision, not a
drive-by fix — left as documented future work, not flagged as an open
finding since nothing here is broken, only absent.

**Note:** this also resolved a LOW finding one reviewing agent raised
separately — the body-buffering fallback's `except` handler could leave
`actual_receive` pointing at an already-partially-drained `receive`
callable if the stream errored mid-buffer, silently truncating the body
downstream. Removing the buffering mechanism removes this failure mode
entirely rather than patching it.

## Schema & migration notes

No new columns or tables this pass; no schema-touching changes.

## Guard tests added

- `tests/test_security_middleware.py::TestSecurityMonitoringMiddlewareReadsTheRealAuthenticatedUser`
  — 2 tests (CI2-33-1).
- `tests/test_security_middleware.py::TestRateLimiter` — 3 new tests
  (CI2-33-2).
- `tests/test_database_manager.py::TestConnectScrubsThePasswordOnTotalFailure`
  — 2 tests (CI2-33-3).
- `tests/test_core_infra_boot_checks.py::TestAlgorithmMustBeHS256` — 3 tests
  (CI2-33-4).
- `tests/test_core_infra_boot_checks.py::TestAuditLogSigningKeyIsWarnedLikeItsSibling`
  — 2 tests (CI2-33-5).
- `tests/test_core_infra_boot_checks.py::TestCaptchaSecretKeyPairing` — 3
  tests (CI2-33-6).
- `tests/test_security_middleware.py::TestIPLoggingMiddlewareRequestIdValidation`
  — 3 tests (CI2-33-7).
- `tests/test_core_infra_boot_checks.py::TestTrustedProxyRangeSanity` — 4
  tests (CI2-33-8).
- `tests/test_security_middleware.py::TestInputSanitizer` — 3 new tests
  (CI2-33-9, CI2-33-12).
- `tests/test_security_middleware.py::TestVerifyCSRFTokenDependency` — 2 new
  tests (CI2-33-10).
- `tests/test_database_manager.py::TestDisconnectResetsConnectionState` — 2
  tests (CI2-33-11).

## Completion gate

| Check                                                                                                                                                                                                                                                     | Result                                                                                                                                                                                                                                                                                                                 |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `flake8 app/ tests/ alembic/`                                                                                                                                                                                                                             | ✅ 0 violations                                                                                                                                                                                                                                                                                                        |
| `black --check app/ tests/ alembic/`                                                                                                                                                                                                                      | ✅ clean                                                                                                                                                                                                                                                                                                               |
| `isort --check-only app/ tests/ alembic/`                                                                                                                                                                                                                 | ✅ clean                                                                                                                                                                                                                                                                                                               |
| `python3 scripts/validate_migrations.py --strict`                                                                                                                                                                                                         | ✅ passed (no schema change)                                                                                                                                                                                                                                                                                           |
| Scoped backend tests (`test_security_middleware.py`, `test_core_infra_boot_checks.py`, `test_database_manager.py`, `test_database_url_encoding.py`, `test_onboarding_rate_limit_scopes.py`, `test_startup_diagnostics.py`, `test_tls_required_config.py`) | ✅ 149 passed                                                                                                                                                                                                                                                                                                          |
| Full backend suite (`pytest tests/`)                                                                                                                                                                                                                      | ✅ 8972 passed, 38 failed, 22 skipped. The 38 failures (`test_public_legal.py`, `test_agency_position_seeding.py`, `test_onboarding_integration.py`, `test_facilities_onboarding.py`) are pre-existing and unrelated — the identical set confirmed unrelated to this diff in the immediately preceding feature's pass. |
| `tsc --noEmit` / `eslint`                                                                                                                                                                                                                                 | n/a — no frontend file changed this iteration                                                                                                                                                                                                                                                                          |
