# Security Review — Feature 33: Core Infrastructure (re-verification)

**Prefix:** `CI` · **Iteration:** 33 · **Reviewed:** 2026-08-31 · **PR:** (opening)

**Backend:** `app/core/security_middleware.py` (1,422 L), `app/core/config.py`
(1,041 L), `app/core/database.py` (248 L).
**Frontend:** none this pass.
**Migrations:** none.

This is the rotation's next scheduled look at Core Infrastructure, following
[`CI2-33-core-infra.md`](./CI2-33-core-infra.md) (2026-08-27, PR #1917 — 14
findings, all fixed). Between that merge and this review, **none of the
three files in this feature's scope changed at all**: `git diff` of the
close-out commit (`e05991a8`) against current `main` for
`security_middleware.py`, `config.py` and `database.py` is empty, and the
adjacent files CI2-33 declared out of scope (`security.py`, `cache.py`,
`websocket_manager.py`, `encrypted_types.py`) are unchanged too. `main.py`'s
middleware registration block (lines 2036–2100) is also byte-identical over
the same range.

Rather than skip the iteration on that basis, this pass did what a
zero-diff still obligates: re-read all three files in full and re-verified,
against the actual current code rather than the prior write-up, that every
one of CI2-33's 14 fixes is still present and structurally sound.

**0 new findings.** Nothing changed, and nothing was found that CI2-33
missed.

---

## Scope

**Read in full:** `security_middleware.py` (all 1,422 lines),
`config.py` (the boot-check block, `lines 380–420` and `555–600`, plus
`TRUSTED_PROXY_IPS`-related helpers at `319`, `649–670`), `database.py`
(all 248 lines).

**Confirmed unchanged, not re-read line-by-line a second time:**
`security.py`, `cache.py`, `websocket_manager.py`, `encrypted_types.py` —
`git diff` against the CI2-33 close-out commit is empty for all four.

**Not touched this pass:** same as CI2-33 — this feature's scope is the
middleware/config/database layer, not `audit.py` or `permissions.py`, which
are reviewed under their own rotation features (28, 02).

## Re-verification of CI2-33's 14 findings

Each one checked against the live file at the cited location, not assumed
from the prior write-up:

| id         | fix                                                                                                                                                                                                               | still present?                                                           |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| CI2-33-1   | `SecurityMonitoringMiddleware` reads `request.state.authenticated_user` **after** `self.app()` returns (`security_middleware.py:1358–1365`)                                                                       | ✅                                                                       |
| CI2-33-2   | `RateLimiter._evict_stale` judges each key's staleness against its own recorded `_key_windows[k]`, not the sweep's trigger window (`:58–104`)                                                                     | ✅                                                                       |
| CI2-33-3   | `database.py` `connect()` re-raises only the password-scrubbed detail on total failure (`:168–180`)                                                                                                               | ✅                                                                       |
| CI2-33-4   | `config.py:388–392` boot check rejects any `ALGORITHM` other than `"HS256"`                                                                                                                                       | ✅                                                                       |
| CI2-33-5   | `config.py:596–598` warns when `AUDIT_LOG_SIGNING_KEY` is unset, mirroring `VOTE_SIGNING_KEY`                                                                                                                     | ✅                                                                       |
| CI2-33-6   | `config.py:562–587` warns on `CAPTCHA_ENABLED` with an empty/mismatched secret                                                                                                                                    | ✅                                                                       |
| CI2-33-7   | `IPLoggingMiddleware` only reuses an incoming `X-Request-ID` that matches `_REQUEST_ID_RE` (16 lowercase hex), else generates one (`security_middleware.py:1149`, `:1186–1191`)                                   | ✅                                                                       |
| CI2-33-8   | `config.py:414–416` warns when a `TRUSTED_PROXY_IPS` entry's `prefixlen` is below `_min_prefix`                                                                                                                   | ✅                                                                       |
| CI2-33-9   | `InputSanitizer.sanitize_string` HTML-escapes **before** truncating, and trims a partially-cut trailing entity (`security_middleware.py:304–320`)                                                                 | ✅                                                                       |
| CI2-33-10  | onboarding CSRF bypass is an anchored `request_path.startswith("/api/v1/onboarding")`, not a substring match (`:817–819`)                                                                                         | ✅                                                                       |
| CI2-33-11  | `DatabaseManager.is_connected` is a computed property (`engine is not None and session_factory is not None`); `disconnect()` sets both to `None` (`database.py:66–69`, `:182–188`) — structurally cannot go stale | ✅                                                                       |
| CI2-33-12  | `InputSanitizer.validate_url` rejects a bare IPv4-literal host (`security_middleware.py:425–432`)                                                                                                                 | ✅                                                                       |
| CI2-33-13  | request-body buffering for the never-implemented injection-detector is gone; `SecurityMonitoringMiddleware`'s docstring states plainly that no such analysis runs (`:1260–1266`)                                  | ✅                                                                       |
| CI-9/CI-10 | prior module-audit residual ops/design items (TLS posture, `optimize_image` fail-open, Redis `CERT_NONE`, no cache tenant namespacing, WS accept-before-auth, MFA recovery-code entropy)                          | re-confirmed accurate, still open by design — not re-flagged, per CI2-33 |

`main.py`'s middleware stack order (`SecurityHeadersMiddleware` →
`TrustedHostMiddleware` → `SecurityMonitoringMiddleware` →
`IPBlockingMiddleware` → `IPLoggingMiddleware` → `CORSMiddleware` →
`GZipMiddleware` → `RequestSizeLimitMiddleware` outermost) is unchanged from
CI2-33 and still matches every ordering comment in the middleware classes
themselves (e.g. `RequestSizeLimitMiddleware` added last so it wraps
outermost and rejects oversized bodies before any inner layer buffers them).

## Verified good ✅ (re-confirmed, no regression)

- **All 14 CI2-33 fixes hold**, checked against current code line-by-line —
  table above.
- **No new middleware, config flag, or database code path was added** since
  CI2-33 — `git diff e05991a8..origin/main` is empty for every file in this
  feature's scope, so there is no new surface to review.
- **Guard tests still exist and pass**: `test_security_middleware.py`,
  `test_core_infra_boot_checks.py`, `test_database_manager.py`,
  `test_database_url_encoding.py`, `test_onboarding_rate_limit_scopes.py`,
  `test_startup_diagnostics.py`, `test_tls_required_config.py` — 166/166
  passed (was 149/149 at CI2-33; the growth is from unrelated feature work
  elsewhere adding to shared suites, not from this feature).

## Findings

None. Zero code drift since CI2-33's line-by-line pass; all 14 prior fixes
re-verified intact; no new findings.

## Schema & migration notes

n/a — no schema-touching code in this feature's scope, no change this pass.

## Guard tests added

None — the existing CI2-33 guard tests already cover every fixed class and
continue to pass. No new class of defect to guard against.

## Completion gate

| Check                                             | Result                                          |
| ------------------------------------------------- | ----------------------------------------------- |
| `flake8 app/ tests/ alembic/`                     | ✅ 0 violations                                 |
| `black --check app/ tests/ alembic/`              | ✅ 1343 files unchanged                         |
| `isort --check-only app/ tests/ alembic/`         | ✅ clean                                        |
| `python3 scripts/validate_migrations.py --strict` | ✅ 394 revisions, single head, no schema change |
| Scoped backend tests (same 7 files as CI2-33)     | ✅ 166 passed                                   |
| `tsc --noEmit` / `eslint .`                       | n/a — no frontend file in scope, none changed   |

No code changed this iteration, so the gate is a confirmation that the
existing state is still clean, not a check on a new diff.
