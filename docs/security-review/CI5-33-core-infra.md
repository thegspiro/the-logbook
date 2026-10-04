# Security Review — Feature 33: Core Infrastructure (pass 5)

**Prefix:** `CI5` · **Iteration:** 33 · **Reviewed:** 2026-10-04 · **PR:** TBD

**Backend:** `app/core/security_middleware.py` (1,741 L, up from pass 4's
1,732 L), `app/core/config.py` (1,341 L, up from pass 4's 1,041 L —
substantial growth, reviewed below), `app/core/database.py` (287 L, up from
pass 4's 278 L).
**Frontend:** none this pass — no frontend file in this feature's scope
changed.
**Migrations:** none — no schema change in these three files.

This is the rotation's fifth pass on Core Infrastructure, following
[`CI-33-core-infra.md`](./CI-33-core-infra.md) (2026-08-31, PR #2106/#2107),
[`CI2-33-core-infra.md`](./CI2-33-core-infra.md) (2026-08-27, PR #1917),
[`CI3-33-core-infra.md`](./CI3-33-core-infra.md) (2026-09-07, PR #2368/#2370 —
the ten-round `RateLimiter` structural refactor), and
[`CI4-33-core-infra.md`](./CI4-33-core-infra.md) (2026-09-13, PR #2529 —
`EXPORT_ENDPOINTS` drift). **0 new findings this pass.** All 30 prior findings
(17+10+2+1) re-verified still correct. Both of CI3-33's flagged, owner-decision
items (CI3-33-3 HIGH, CI3-33-4 LOW) re-confirmed still open, unchanged — not
re-fixed or re-flagged as new.

---

## Scope

**Read in full, this pass:** the diff against pass 4's merge commit
(`cf50593c8`) for all three in-scope files — 1,076 commits landed on `main`
in that window, of which exactly 11 touch these three files (2 in
`security_middleware.py`, 1 in `database.py`, 8 in `config.py`). Every one of
those 11 commits' diff to the in-scope file was read in full, not sampled:

- `security_middleware.py`: `d0385b294` (adds `is_unlogged_path` suppression
  to `IPLoggingMiddleware`'s debug/info log lines) and `26bc35e1a` (adds
  `/api/v1/inventory/not-seen/export` to `EXPORT_ENDPOINTS`).
- `database.py`: `da3d252d3` (`_stamp_utc` now reads from
  `inspect(target).dict` instead of `getattr`, to avoid a second SELECT
  firing from inside a `"refresh"` event handler).
- `config.py`: 7 commits building the "email link domain" feature
  (`245c3fe6a`, `a8044019f`, `2f473efc4`, `04d789f24`, `705b63d9c`,
  `074916ade`, `c73fc9dcb`) plus one (`49a7253ce`) adding a single unrelated
  `int` setting (`PIPELINE_ATTENDANCE_SETTLE_DAYS`) that another feature's
  pass confirmed has a reader in its own commit message and this pass
  independently re-confirmed by grep (see below).

**Re-verified by fresh grep/AST, not re-read line-by-line a fifth time**
(matching CI4's own "no `git diff`, no re-read" precedent for an unchanged
file, extended here to the unchanged _remainder_ of files that did change):
`BaseHTTPMiddleware` usage (0 real, same 8 documenting comments), in-memory
tracker shapes in all three files (no new tracker; the only two dict/set
literals outside the already-reviewed `RateLimiter` are a per-request local
`geo_info: dict = {}` in `IPLoggingMiddleware`, which dies with the request),
raw-exception-to-client leakage (every `detail=` in `security_middleware.py`
is a static string or a rate-limiter-internal canned `reason`, never
attacker- or exception-supplied text), `main.py`'s middleware registration
order (`SecurityHeadersMiddleware` → `TrustedHostMiddleware` → optional
`SecurityMonitoringMiddleware`/`IPBlockingMiddleware`/`IPLoggingMiddleware` →
`CORSMiddleware` → `GZipMiddleware` → `RequestSizeLimitMiddleware`, byte-for-
byte the same as CI3-33/CI4-33 documented), the wildcard-CORS-with-credentials
and `SECRET_KEY`-minimum-length production/staging boot blocks in `main.py`
(`validate_security_configuration()`, both still present and still raise
`RuntimeError`).

**Not touched this pass, same exclusions as CI/CI2/CI3/CI4:** `security.py`,
`cache.py`, `websocket_manager.py`, `encrypted_types.py`, `app/core/audit.py`
(Feature 28's scope), `app/core/permissions.py` (Feature 02's scope).

**New `core/` file since pass 4, explicitly out of this pass's scope:**
`app/core/background_claim.py` (compare-and-swap claim renewal, added by the
CRON-40 fix, PR #2901, merged on `main` during this iteration). That fix
belongs to Feature 31 (Scheduled tasks)'s domain and to the app-review track
per this iteration's own briefing ("already flagged to the user, not part of
your task, don't touch it") — noted here only because it is a new file under
`core/`, not reviewed.

**New `api/public/` route since pass 4, cross-referenced not re-reviewed:**
`app/api/public/branding.py` (unauthenticated installed-app icon/splash
assets). Belongs to Feature 03 (Public surface & webhooks)'s declared scope.
Spot-checked only because it calls this feature's own `public_rate_limit()`
helper (`app/core/security_middleware.py`) — confirmed it is used correctly
(120 req/min per IP, `CodedHTTPException` on exceed), which is evidence the
helper's contract holds for a new consumer, not a finding against this
feature.

## Re-verification of prior findings

All findings from CI-33 (3), CI2-33 (13), CI3-33 (10 `RateLimiter` findings
plus 2 flagged), and CI4-33 (1) checked against the live file at or near their
documented location:

| id                                      | still present/fixed?                                                                                                                                                                                                                                                                                                                                                                                                 |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CI-33-1/2/3, CI2-33-1 through CI2-33-13 | ✅ all still correct, same mechanism CI4-33 last confirmed — no commit in the 1,076-commit window touched any of their documented line ranges other than the 3 changes catalogued above                                                                                                                                                                                                                              |
| CI3-33-1/1a–1e, 2a–2j                   | ✅ all still correct — the unified `_KeyState` structural shape (`:31-46`) is unchanged; `_saturation_reject_until` is still `dict[str, float]` keyed per scope (`:124`) with its own cap/eviction                                                                                                                                                                                                                   |
| CI3-33-3 (flagged, HIGH)                | still open — `REGISTRATION_REQUIRES_APPROVAL` fresh-grepped across `app/`: only the declaration (`config.py:300`) and the still-inaccurate docstring (`auth.py:591`); `register_user()` still unconditionally sets `status=UserStatus.ACTIVE`                                                                                                                                                                        |
| CI3-33-4 (flagged, LOW)                 | still open — fresh greps for `RATE_LIMIT_PER_MINUTE`, `MAX_FILE_SIZE`, `STORAGE_TYPE`, `DB_POOL_MIN` across `app/`, `main.py`, `scripts/`, `alembic/` return zero hits outside their own declarations                                                                                                                                                                                                                |
| CI4-33-1 (`EXPORT_ENDPOINTS` drift)     | ✅ fixed, and its guard test is now demonstrably doing its job: `26bc35e1a` (an unrelated PR, landed after CI4-33 merged) added `/api/v1/inventory/not-seen/export` to both the route table _and_ `EXPORT_ENDPOINTS` in the same commit — the exact behavior the guard test (`TestExportEndpointsCoverage`) exists to force. Re-ran it fresh against current `main`: still passes, 0 missing paths, 0 stale entries. |

`docs/KNOWN_LIMITATIONS.md`'s two mirrored rows for CI3-33-3/CI3-33-4 are
unchanged and still accurate — re-read directly, not assumed.

## New code reviewed fresh

**`database.py`'s `da3d252d3` — a correctness fix, not a security change.**
`_stamp_utc` previously read each UTC-aware column via `getattr(target, attr,
None)`, which on a _partial_ refresh (`session.refresh(obj, ["positions"])`)
could trigger a second SELECT for a still-expired sibling column from
_inside_ the `"refresh"` event handler — exactly the condition SQLAlchemy's
"Loading context ... has changed within a load/refresh handler" error
guards against. The fix reads `inspect(target).dict` (only attributes
already materialized in the instance's state) instead, and the docstring now
states why. No security implication: this listener only stamps `tzinfo` on
already-loaded `DateTime(timezone=True)` values via `set_committed_value`
(not a plain attribute set, so it cannot itself trigger a flush); it does not
gate access or validate input.

**`security_middleware.py`'s `d0385b294` — a deliberate, narrowly-scoped
privacy feature, reviewed for interaction with this file's own controls.**
`IPLoggingMiddleware` now skips its debug ("Request: ...") and info
("{method} {path} → {status}") log lines when `is_unlogged_path()` (defined
in `app/core/logging.py`, `UNLOGGED_PATH = re.compile(r"^/api/v1/suggestions/
(?:boxes/[^/]+/submissions$|follow-up/)")`) matches — the anonymous side of
the suggestion box, where `SuggestionService` already rounds timestamps to
noon so a submission cannot be lined up against a member's sign-in by request
time; an access-log line with the exact second and the client IP would have
undone that. Checked for scope creep and found none: the regex matches only
the two anonymous-submission paths (confirmed by `test_unlogged_paths.py`,
which this pass re-ran, 2 tests passing), the suppression is confined to this
middleware's own debug/info logging (the parallel
`_DropUnloggedAccessFilter` in `logging.py` does the same for uvicorn's own
access log, and `frontend/nginx.conf`/`infrastructure/nginx/nginx.conf` carry
the matching pattern for the proxy — `test_nginx_config_consistency.py`
re-ran clean, confirming the three stay in step), and it does **not** touch
`SecurityMonitoringMiddleware`, `IPBlockingMiddleware`, or `check_rate_limit` —
abuse detection and rate-limiting on these routes are unaffected; only the
plaintext log line is suppressed. `error_reporting.py`'s own exclusion
(`EXCLUDED_PATH_PREFIXES` union `is_unlogged_path(path)`) was also checked:
an unhandled exception on the anonymous submission path is still captured by
Sentry (`EXCLUDED_PATH_PREFIXES` only suppresses the _request-path_ breadcrumb
context, not the event itself — confirmed by reading `error_reporting.py:69-
132` directly), so this is privacy-for-the-access-log, not a blind spot for
operational error tracking.

**`security_middleware.py`'s `26bc35e1a` — the `EXPORT_ENDPOINTS` guard test
working as designed.** Covered above in the re-verification table; recorded
here too because it is this pass's clearest evidence that CI4-33-1's fix
closed the _class_ of defect, not just the one instance: a contributor with
no reason to know `EXPORT_ENDPOINTS` existed added the new export route and
the matching set entry in the same commit, which only happens if their local
`pytest` run (or CI) failed the guard test until they did.

**`config.py`'s 7-commit "email link domain" feature — read in full, found
solid.** `settings.FRONTEND_URL` is a process-wide value every outgoing-email
link builder reads; the feature (a) auto-substitutes the first public
`ALLOWED_ORIGINS` entry for a loopback `FRONTEND_URL` at startup
(`resolve_frontend_url`, a `model_validator(mode="after")`), (b) warns (and in
production, blocks boot with `CRITICAL`) when no such substitution is
possible, and (c) lets an admin save an explicit override. Checked
specifically for the injection risk this kind of "redirect the thing every
password-reset email points at" feature invites:

- **The override is permission-gated to a platform-level grant held by no
  default role.** `PUT`/`DELETE /organizations/settings/email/link-domain`
  both require `system.manage_link_domain`
  (`organizations.py:344,375`), and `app/core/permissions.py:491-496`'s own
  comment states it is granted to no default position — "only the wildcard
  'System Owner' (`it_manager`) matches it" — the same pattern CLAUDE.md
  Pitfall #23 and this file's own prior passes require for a
  broadly-dangerous grant.
- **The override value is validated against an allowlist the admin cannot
  grow.** `validate_link_domain()` (`config.py`) rejects a loopback host, a
  host carrying credentials, a path/query/fragment (every call site
  concatenates `f"{FRONTEND_URL}/..."`, so a path would be appended-to, not
  replaced), and any host not already in `TRUSTED_HOSTS`/`ALLOWED_ORIGINS`
  (`link_domain_allowed_hosts()`) — so the control cannot be used to redirect
  password-reset or ballot links to a look-alike domain, which is the actual
  abuse this kind of setting invites. The comment on
  `link_domain_allowed_hosts()` states this explicitly as `SEC:`.
- **The stored value is scoped to the deployment's own organization, not
  whichever caller's `organization_id` is on the request.**
  `email_link_domain_service._writable_primary()` resolves the "oldest active
  organization" independently and raises `PermissionError` if the caller's
  org doesn't match it — the correct shape for a _deployment-wide_, not
  per-tenant, setting (the docstring states why: "the value belongs to the
  deployment, not to whichever organization happens to ask").
- **The JSON-column write uses `copy.deepcopy()`, not a shallow `dict()`.**
  `set_link_domain`/`clear_link_domain` both `copy.deepcopy(org.settings or
{})` before mutating and reassigning — Pitfall #12-compliant.
- **Cross-worker propagation fails safe.** `app/core/link_domain_sync.py`
  (new file, not itself in this feature's declared scope, but read because
  `main.py`'s lifespan wires it directly into this feature's boot sequence)
  mirrors the existing `geoip_sync` pattern: Redis pub/sub with a 60s
  periodic-refresh backstop, and a worker that cannot reach Redis at all
  degrades to "eventually consistent within 60s" rather than failing to
  start or desyncing permanently.

No finding. Recorded at this length because a feature that changes where
every password-reset and ballot link in the system points is exactly the
shape of change this feature's own checklist (§2, §5) exists to catch, and
"verified good" needs the mechanism stated, not asserted.

## Verified good ✅ (re-confirmed, no regression)

- **All 30 prior findings across CI-33/CI2-33/CI3-33/CI4-33 hold.** See the
  re-verification table above.
- **`main.py`'s middleware stack, registration order, and both
  production/staging boot-blocking checks (wildcard CORS+credentials,
  `SECRET_KEY` strength) are unchanged.** Mechanism: grep for the relevant
  `add_middleware`/`RuntimeError` call sites, confirmed present at the
  expected guards.
- **`BaseHTTPMiddleware` has zero real usages anywhere in the three in-scope
  files** (and the backend generally, per SEC-00's own standing sweep).
  Mechanism: `grep -rn "BaseHTTPMiddleware"` — 8 hits, all documenting
  comments.
- **No new unbounded in-memory tracker was introduced in the 1,076-commit
  window.** Mechanism: the only new dict/set-shaped assignments in the three
  files' diffs are `PrivateAttr` string fields on the `Settings` singleton
  (configuration state, not an attacker-growable cache) and a per-request
  local `dict` in `IPLoggingMiddleware` — neither is a tracker in the sense
  Pitfall #9 describes.
- **The `EXPORT_ENDPOINTS` guard test (CI4-33-1) is holding in practice, not
  just in theory** — see the dedicated note above.
- **The "email link domain" feature's permission gate, host allowlist,
  org-scoping, and JSON-mutation pattern are all correct**, reviewed in full
  above rather than assumed because the originating commits were authored by
  a different rotation pass.

## Findings

None this pass. Both items CI3-33 flagged remain open and unchanged; no new
defect was found in the 11 commits that touched this feature's three files
since pass 4, nor in a fresh sweep of the standing invariants (middleware
pattern, boot-time checks, tracker bounds, exception-leak shape) across those
same files.

## Schema & migration notes

n/a — no schema-touching change in this feature's scope this pass. Alembic
chain re-validated: 509 revisions, single head `d058b5e7c1f4`, no duplicate
ids (`validate_migrations.py --strict`).

## Guard tests added

None. Every invariant this pass checked already has a standing guard test
from a prior pass (`test_security_middleware.py`'s `TestExportEndpointsCoverage`,
`test_unlogged_paths.py`, `test_nginx_config_consistency.py`,
`test_email_link_domain.py`, `test_core_infra_boot_checks.py`, and the
cross-cutting sweeps in `SEC-00`) — this pass found nothing new to close a
class on.

## Completion gate

| Check                                                                                                                                                                                                                                                                                                                                                | Result                                                                                                                                              |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `flake8 app/ tests/ alembic/`                                                                                                                                                                                                                                                                                                                        | ✅ 0 violations                                                                                                                                     |
| `black --check app/ tests/ alembic/`                                                                                                                                                                                                                                                                                                                 | ✅ clean, 1,856 files unchanged                                                                                                                     |
| `isort --check-only app/ tests/ alembic/` (9.0.1, CI's pin)                                                                                                                                                                                                                                                                                          | ✅ clean                                                                                                                                            |
| `python3 scripts/validate_migrations.py --strict`                                                                                                                                                                                                                                                                                                    | ✅ 509 revisions, single head `d058b5e7c1f4`                                                                                                        |
| Scoped tests (`test_security_middleware.py`, `test_core_infra_boot_checks.py`, `test_database_manager.py`, `test_database_url_encoding.py`, `test_onboarding_rate_limit_scopes.py`, `test_startup_diagnostics.py`, `test_tls_required_config.py`, `test_openapi_contract.py`)                                                                        | ✅ 241 passed                                                                                                                                       |
| Feature-specific tests touched since pass 4 (`test_email_link_domain.py`, `test_install_sh_frontend_url.py`, `test_installer_frontend_url.py`, `test_unlogged_paths.py`, `test_nginx_config_consistency.py`)                                                                                                                                         | ✅ 364 passed                                                                                                                                       |
| Cross-cutting guard tests (`test_like_escaping.py`, `test_csv_writer_sweep.py`, `test_database_schema.py::test_set_null_fks_are_nullable`, `test_org_scoping_ratchet.py`, `test_capacity_locking.py`, `test_endpoint_auth_coverage.py`, `test_api_cache_pii_exclusions.py`, `test_migration_create_all_tables.py`, `test_baseline_member_grants.py`) | ✅ 141 passed                                                                                                                                       |
| Full backend unit suite (`pytest tests/ -m "not integration and not slow and not docker"`)                                                                                                                                                                                                                                                           | ✅ **12,493 passed, 1 skipped**, 3,244 deselected (the 1 skip is `test_push_service.py`'s optional `py_vapid`/`pywebpush` dependency, pre-existing) |
| `cd frontend && npm run typecheck` (aliased TS 7.0.2, the actual build compiler)                                                                                                                                                                                                                                                                     | ✅ 0 errors                                                                                                                                         |
| `cd frontend && npm run lint` (eslint, max-warnings 10)                                                                                                                                                                                                                                                                                              | ✅ 0 errors, 0 warnings                                                                                                                             |

**Fresh worktree note:** this iteration ran in a worktree with no
`node_modules` installed. Ran `npm ci` from the repo root once (never `rm
package-lock.json && npm install`, per CLAUDE.md), which resolved cleanly
against the committed lockfile (621 packages). `isort` was already present
at the CI-pinned 9.0.1, so no install was needed for it.
