# Security Review — Feature 33: Core Infrastructure (pass 4)

**Prefix:** `CI4` · **Iteration:** 33 · **Reviewed:** 2026-09-13 · **PR:** (opened this pass)

**Backend:** `app/core/security_middleware.py` (1,730 L → 1,732 L after this
pass's fix), `app/core/config.py` (1,041 L, unchanged), `app/core/database.py`
(278 L — grew from 254 L since pass 3, a legitimate unrelated fix landed by
Feature 13's own rotation pass, reviewed fresh below).
**Frontend:** none this pass.
**Migrations:** none — no schema change.

This is the rotation's fourth pass on Core Infrastructure, following
[`CI-33-core-infra.md`](./CI-33-core-infra.md) (2026-08-31, PR #2106/#2107 —
3 findings, all fixed, plus 14 prior findings re-verified),
[`CI2-33-core-infra.md`](./CI2-33-core-infra.md) (2026-08-27, PR #1917 — 14
findings, all fixed), and [`CI3-33-core-infra.md`](./CI3-33-core-infra.md)
(2026-09-07, PR #2368/#2370 — 10 `RateLimiter` findings across ten Codex
rounds culminating in a structural refactor, plus 2 flagged config-switch
findings). **1 new finding, MED, fixed** (`EXPORT_ENDPOINTS` had drifted
again — see CI4-33-1). All 17+10+2 = 29 prior findings re-verified still
correct at current line numbers. The 2 config-switch findings CI3-33 flagged
(CI3-33-3/4) re-confirmed still open, unchanged, not re-fixed or re-flagged
as new.

---

## Scope

**Read in full, this pass:** `security_middleware.py` (all 1,730 lines, before
this pass's 2-line addition), `database.py` (all 278 lines — the new
`refresh`-event listener since pass 3, reviewed fresh, plus the rest
re-confirmed unchanged).

**`config.py`: not re-read line-by-line a fourth time.** `git diff` against
pass 3's merge commit (`680905c95`) is empty for this file — confirmed via
`git log --oneline 680905c95..HEAD -- app/core/config.py` returning nothing.
Pass 3 (CI3-33) already did the first full end-to-end read of this file in
the rotation's history; this pass instead re-verified the two flagged
findings (CI3-33-3, CI3-33-4) still have no reader anywhere (fresh greps,
below), re-checked `validate_cors_config()`/`validate_security_config()`'s
wildcard-CORS-with-credentials boot-block and the `SECRET_KEY` minimum-length
check directly in `main.py`'s `validate_security_configuration()` (still
gates production/staging boot on a `CRITICAL` wildcard-origin finding), and
confirmed no new `Settings` field was added that would need the same
no-reader sweep CI3-33-4 already did exhaustively.

**Not touched this pass:** `security.py`, `cache.py`, `websocket_manager.py`,
`encrypted_types.py` — outside this feature's declared scope per CI/CI2/CI3.
`app/core/audit.py` and `app/core/permissions.py` belong to Features 28 and
02 respectively (both `✅` in the rotation table) — cross-referenced only
where directly relevant (see "SEC2-28-10, re-confirmed" below), not
re-reviewed. `main.py`'s middleware registration block (lines ~2050–2115) and
`dependencies.py` were spot-checked (below), not read end-to-end, since both
are outside this feature's own file list and `dependencies.py` belongs to
Feature 02's already-`✅` scope.

## Re-verification of prior findings

All findings from CI-33 (3), CI2-33 (13), and CI3-33 (10 `RateLimiter`
findings plus 2 flagged config-switch items) checked against the live file at
their documented location, not assumed from the prior write-up:

| id                        | fix                                                                                                                                                                                                       | still present?                                                        |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| CI-33-1 / CI2-33-2        | `RateLimiter._sweep` (renamed from `_evict_stale`) judges each key's staleness against its own `_KeyState.window_seconds` (`:179-186`)                                                                    | ✅ (now folded into the unified `_KeyState` shape)                    |
| CI-33-2                   | `daily_cap_exceeded` self-heals a missing TTL after a successful `INCR` (`:538-550`)                                                                                                                      | ✅                                                                    |
| CI-33-3 / CI2-33-11       | `DatabaseManager.disconnect()` resets `engine`/`session_factory` in `finally` even when `dispose()` raises (`database.py:203-218`)                                                                        | ✅                                                                    |
| CI2-33-1                  | `SecurityMonitoringMiddleware` reads `request.state.authenticated_user` after `self.app()` returns (`:1666-1673`)                                                                                         | ✅                                                                    |
| CI2-33-3                  | `database.py connect()` re-raises only the scrubbed detail, `from None`, scrubbing both raw and percent-encoded password forms (`:196-200`, `:151-160`)                                                   | ✅                                                                    |
| CI2-33-4                  | `config.py` boot check rejects any `ALGORITHM != "HS256"`                                                                                                                                                 | ✅ (unchanged file, `git diff` empty)                                 |
| CI2-33-5/6                | `config.py` warns when `AUDIT_LOG_SIGNING_KEY` is unset / `CAPTCHA_ENABLED` has an empty/mismatched secret, site key, or provider                                                                         | ✅ (unchanged file)                                                   |
| CI2-33-7                  | `IPLoggingMiddleware` only reuses an incoming `X-Request-ID` matching `_REQUEST_ID_RE` (`:1457`, `:1494-1499`)                                                                                            | ✅                                                                    |
| CI2-33-8                  | `config.py` warns on a `TRUSTED_PROXY_IPS` entry narrower than the IPv4/IPv6-aware minimum                                                                                                                | ✅ (unchanged file)                                                   |
| CI2-33-9                  | `InputSanitizer.sanitize_string` escapes before truncating, trims a cut entity (`:612-628`)                                                                                                               | ✅                                                                    |
| CI2-33-10                 | onboarding CSRF bypass is `request_path.startswith("/api/v1/onboarding")` (`:1126`)                                                                                                                       | ✅                                                                    |
| CI2-33-12                 | `InputSanitizer.validate_url` rejects a bare IPv4-literal host (`:736-740`)                                                                                                                               | ✅                                                                    |
| CI2-33-13                 | injection-detection dead body-buffering is gone; class docstring states no such analysis runs (`:1568-1573`)                                                                                              | ✅                                                                    |
| CI3-33-1/2/1a/1b/1c/1d/1e | Superseded by the structural refactor — `RateLimiter` now stores one `_KeyState` per key (`request_times`, `window_seconds`, `lockout_until`), so the split-state class of bug is structurally impossible | ✅ (`:31-46`, class-level invariant, not a per-fix location any more) |
| CI3-33-2a                 | `_saturation_reject_until` is `dict[str, float]` keyed per scope, not one global scalar (`:124`, `:441`)                                                                                                  | ✅                                                                    |
| CI3-33-2b/2c/2d           | Capacity accuracy via a throttled `_refresh_active_lockout_count` (1s), not a full sweep on every request or every retry (`:256-285`)                                                                     | ✅                                                                    |
| CI3-33-2e                 | `_saturation_reject_until` bounded by `_MAX_SATURATION_SCOPES` and swept (`:94`, `:225-243`)                                                                                                              | ✅                                                                    |
| CI3-33-2g/2h              | `_MAX_KEYS` enforcement budgets _evictable_ keys, not the combined locked-out+unlocked total (`:190-223`)                                                                                                 | ✅                                                                    |
| CI3-33-2i                 | `lockout_seconds <= 0` insertions never increment the shared `_active_lockout_count` (`:395-396`)                                                                                                         | ✅                                                                    |
| CI3-33-2j                 | The saturation signal only commits from a `just_verified` (this-call-fresh) count (`:380`, `:417`)                                                                                                        | ✅                                                                    |
| CI3-33-3 (flagged)        | `REGISTRATION_REQUIRES_APPROVAL` still has no reader anywhere                                                                                                                                             | still open — re-confirmed, not re-fixed (see below)                   |
| CI3-33-4 (flagged)        | `RATE_LIMIT_PER_MINUTE`/`MAX_FILE_SIZE`/`STORAGE_TYPE`/`DB_POOL_MIN` still have no reader                                                                                                                 | still open — re-confirmed, not re-fixed (see below)                   |

`main.py`'s middleware registration block is unchanged from CI3-33's
description (verified via `git log --oneline 680905c95..HEAD -- main.py`
returning nothing): `SecurityHeadersMiddleware` first, `TrustedHostMiddleware`
conditionally, `SecurityMonitoringMiddleware` in production only,
`IPBlockingMiddleware`/`IPLoggingMiddleware` conditionally, `CORSMiddleware`,
`GZipMiddleware`, `RequestSizeLimitMiddleware` last (outermost). A repo-wide
grep for `BaseHTTPMiddleware` (`grep -rn "BaseHTTPMiddleware" --include="*.py" .`
from `backend/`) returns only the ban-documenting comments in
`security_middleware.py` and one matching comment in `app/mcp/transport.py` —
zero real usage anywhere in the backend.

**CI3-33-3/CI3-33-4 re-verified still open, not re-fixed:** fresh greps for
`REGISTRATION_REQUIRES_APPROVAL` across `app/` return only the declaration
(`config.py:300`) and the still-inaccurate docstring in `auth.py:587`;
`register_user()` still unconditionally sets `status=UserStatus.ACTIVE`.
Fresh greps for `RATE_LIMIT_PER_MINUTE`, `MAX_FILE_SIZE`, `STORAGE_TYPE`, and
`DB_POOL_MIN` across `app/`, `main.py`, `scripts/`, `alembic/` still return
zero hits outside their own declarations. Both remain product/architecture
decisions outside a review pass's safe-fix scope, per CI3-33's own reasoning;
mirrored entries in `docs/KNOWN_LIMITATIONS.md` are unchanged and accurate.

**`app/core/audit.py`'s SEC2-28-10, re-confirmed still open (not this
feature's finding, not re-fixed here):** the audit hash chain's missing
write-concurrency control (two simultaneous audit-log writes on independent
sessions can read the same "last row" and fork the chain, which
`verify_integrity` then reports indistinguishably from tampering) is Feature
28's flagged finding, most recently re-verified in that feature's own pass 4
(`docs/security-review/SEC2-28-security-audit-ip.md`, 2026-09-13). Confirmed
here only because `IPBlockingMiddleware._log_blocked_attempt` and
`SecurityMonitoringMiddleware`'s two detectors — both in this feature's file
scope — are two of the reachable call sites the finding names; the finding
itself, its severity, and its "why not fixed" reasoning are unchanged and
belong to Feature 28's document, not duplicated here.

## New code reviewed fresh — `database.py`'s `"refresh"` event listener

Since CI3-33's pass, an unrelated fix (Feature 13's own rotation, "Apparatus &
NFC" pass 11, commit `1005d5bac`) extracted `_on_load_stamp_utc`'s body into a
shared `_stamp_utc(target)` helper and added a second listener,
`_on_refresh_stamp_utc`, registered on SQLAlchemy's `"refresh"` event
(`database.py:62-75`) rather than only `"load"`. This closes a real
data-correctness gap — `session.refresh()` and a locking read with
`execution_options(populate_existing=True)` (used by
`SchedulingService.get_shift_by_id`, part of CLAUDE.md Pitfall #27's
capacity-locking pattern) both repopulate an already-identity-mapped instance
via a distinct SQLAlchemy event, so without this second listener a
`DateTime(timezone=True)` column would go naive again on such a re-read even
though the row was correctly tagged UTC on its first load. Reviewed fresh, not
merely diffed: `_stamp_utc` is idempotent (only rewrites a column when
`val.tzinfo is None`, so a second call after the first listener already
stamped it is a no-op), uses `set_committed_value` (not a plain attribute
assignment) so the stamp does not itself mark the instance dirty or trigger an
UPDATE on the next flush, and both listeners are `propagate=True` on `Base`,
covering every ORM model uniformly. Not a security defect and not this
feature's own finding to claim — recorded here because it is the one change
to an in-scope file since pass 3, and the read-every-line-touched-since-last-
pass discipline applies regardless of which rotation feature produced the
diff.

## Findings

### CI4-33-1 — MED — `EXPORT_ENDPOINTS` had drifted again: two new export routes added by an unrelated feature pass were never added to the data-exfiltration monitoring set — ✅ FIXED

**What:** `SecurityMonitoringMiddleware.EXPORT_ENDPOINTS` is a hand-maintained
exact-match set of route paths used to gate `detect_data_exfiltration`
monitoring on GET/POST responses. CI2-33 built it from a point-in-time grep of
every `export`-containing route (2026-08-27); CI3-33 re-verified it unchanged
(2026-09-07). A day after CI3-33's pass, an unrelated PR (`320a143df`,
"security(finance-approvals): 4 fixes, 1 flagged (pass 4)", 2026-09-08) added
two new GET routes under `finance.py`'s `/export` section —
`list_export_mappings` (`GET /export/mappings`) and `list_export_logs`
(`GET /export/logs`) — with no reason for that PR's author to know
`EXPORT_ENDPOINTS` existed or that adding an `export`-named route anywhere in
the API silently requires a matching entry in a different feature's
middleware file.

**Where:** `backend/app/core/security_middleware.py`,
`SecurityMonitoringMiddleware.EXPORT_ENDPOINTS` (the set itself);
`backend/app/api/v1/endpoints/finance.py:1514` (`list_export_mappings`) and
`:1600` (`list_export_logs`), mounted at `/api/v1/finance/export/mappings`
and `/api/v1/finance/export/logs` respectively (`api.py`'s
`finance.router` registration, `prefix="/finance"`).

**Failure scenario:** confirmed directly by building the app's live OpenAPI
schema (`from main import app; app.openapi()["paths"]`) and diffing every
non-parameterized path containing `"export"` against
`SecurityMonitoringMiddleware.EXPORT_ENDPOINTS` — the two finance routes
above are the only two present in the real route table but absent from the
set. Both require `finance.manage` permission and are gated behind the
`finance` module, so this is not an unauthenticated leak, but a member with
that permission exporting either (bank-account-to-category mapping config,
or the export-audit-log itself) generates zero data-exfiltration monitoring
signal — the exact silent-coverage-gap shape CI2-33-1/CI2-33-13 already
established for this class in this file, recurring here as set staleness
rather than a logic bug.

**Impact:** the data-exfiltration detector (`security_monitor
.detect_data_exfiltration`) never runs for these two export routes, so an
unusually large or repeated export of finance mapping/log data through them
produces no alert, no audit signal beyond ordinary endpoint logging — the
same detection gap CI2-33-1 fixed for the timing bug and CI3-33 inherited as
a documented limitation for `training_programs.py`'s parameterized route, now
also true of these two non-parameterized ones purely because the set was
never updated. This is a monitoring/defense-in-depth gap, not a primary
access-control failure (the routes are still correctly permission-gated) —
consistent with why prior passes classified `EXPORT_ENDPOINTS` gaps as MED
rather than HIGH.

**Fix:** added both paths to `EXPORT_ENDPOINTS`
(`/api/v1/finance/export/logs`, `/api/v1/finance/export/mappings`),
alphabetically ordered alongside the existing `/api/v1/finance/export
/transactions` entry, matching the set's existing style. Re-verified via the
same OpenAPI-schema diff that the set now contains every real,
non-parameterized `export` route in the app — the only remaining
uncovered route is `training_programs.py`'s parameterized
`/api/v1/training/programs/programs/{program_id}/export`, the same
structural (exact-match-set-cannot-cover-a-path-parameter) limitation CI2-33
already documented and did not attempt to fix here either, for the same
reason: it needs a prefix/pattern check, not a data addition.

**Guard test added, closing the class rather than just this instance:**
`tests/test_security_middleware.py::TestExportEndpointsCoverage` — builds the
live OpenAPI schema (`from main import app; app.openapi()`) and asserts (a)
every non-parameterized path containing `"export"` is a member of
`EXPORT_ENDPOINTS`, and (b) `EXPORT_ENDPOINTS` names no path that no longer
exists in the route table. This is the first automated check on this set —
CI2-33/CI3-33 both verified it by a one-time manual grep, which is exactly
how it silently drifted between CI3-33 and this pass. Verified
**fail-before/pass-after**: reverting the `EXPORT_ENDPOINTS` addition (`git
stash` on `security_middleware.py` alone, keeping the new test) reproduces
the exact failure —
`test_every_non_parameterized_export_route_is_covered` fails naming both
missing finance paths — and passes once the fix is restored.

## Verified good ✅ (re-confirmed, no regression)

- **All 29 prior findings across CI-33/CI2-33/CI3-33 hold** — see the
  re-verification table above.
- **`main.py`'s middleware stack** — pure ASGI throughout, unchanged
  registration order, `main.py` byte-identical to pass 3 for this file
  (`git log` empty since `680905c95`).
- **Wildcard CORS + credentials still blocks production/staging boot.**
  `main.py:1306-1310`'s `validate_security_configuration()` appends a
  `CRITICAL` warning whenever `"*"` is in `settings.ALLOWED_ORIGINS`
  (independent of, and in addition to, `Settings.validate_cors_config()`'s
  own check), and `critical_warnings and settings.ENVIRONMENT in
("production", "staging")` raises `RuntimeError` before the app can start
  (`main.py:1336-1342`) — the specific "critical CORS misconfiguration" this
  rotation's instructions asked to re-verify.
- **`SECRET_KEY` minimum-length/non-default check** — `config.py`'s
  `validate_security_config()` (unchanged file) still rejects a `SECRET_KEY`
  under 32 characters or matching a known insecure default with `CRITICAL`,
  gating production/staging boot the same way.
- **`database.py`'s new `"refresh"` listener** — reviewed fresh above, a
  correctness fix (not a regression), idempotent, uses `set_committed_value`
  correctly, no security implication.
- **Rate-limit scope strings remain literal at every call site.** A fresh
  grep of every `check_rate_limit(..., scope=...)` and `public_rate_limit
(key=...)` call site confirms every scope prefix is still a string literal
  written into the calling code — the assumption `_saturation_reject_until`'s
  `_MAX_SATURATION_SCOPES` defense-in-depth cap (CI3-33-2e) is guarding
  against, not yet load-bearing, still holds.

## Schema & migration notes

n/a — no schema-touching change in this feature's scope this pass.

## Guard tests added

- `tests/test_security_middleware.py::TestExportEndpointsCoverage` — 2 tests
  (`test_every_non_parameterized_export_route_is_covered`,
  `test_no_stale_entries_for_routes_that_no_longer_exist`), both against the
  live OpenAPI schema. Verified fail-before/pass-after for CI4-33-1 (see
  above).

## Completion gate

| Check                                                                                                                                                                                                                                                                         | Result                                                                                                                                                               |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `flake8 app/ tests/ alembic/`                                                                                                                                                                                                                                                 | ✅ 0 violations                                                                                                                                                      |
| `black --check app/ tests/ alembic/`                                                                                                                                                                                                                                          | ✅ clean (1,592 files unchanged)                                                                                                                                     |
| `isort --check-only app/ tests/ alembic/`                                                                                                                                                                                                                                     | ✅ clean                                                                                                                                                             |
| `python3 scripts/validate_migrations.py --strict`                                                                                                                                                                                                                             | ✅ 444 revisions, single head `6ab7d903fae5`, no schema change                                                                                                       |
| Scoped tests (`test_security_middleware.py`, `test_core_infra_boot_checks.py`, `test_database_manager.py`, `test_database_url_encoding.py`, `test_onboarding_rate_limit_scopes.py`, `test_startup_diagnostics.py`, `test_tls_required_config.py`, `test_openapi_contract.py`) | ✅ 209 passed                                                                                                                                                        |
| Full backend suite (`pytest tests/`)                                                                                                                                                                                                                                          | ✅ 12,550 passed, 21 skipped, 0 failed (skips all pre-existing: optional `pywebpush`, Docker registry/daemon unavailable in this sandbox, opt-in API-contract suite) |
| `tsc --noEmit` / `npm run typecheck` (aliased TS 7.0.2, the actual build compiler)                                                                                                                                                                                            | ✅ 0 errors                                                                                                                                                          |
| `npm run lint` (eslint, max-warnings 10)                                                                                                                                                                                                                                      | ✅ 0 errors, 0 warnings                                                                                                                                              |
