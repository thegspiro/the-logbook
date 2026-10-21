# Security Review — Feature 33: Core Infrastructure (pass 8)

**Prefix:** `CI8` · **Iteration:** 33 · **Reviewed:** 2026-10-21 · **PR:** (recorded after open)

**Backend:** `app/core/security_middleware.py` (+23/-3 lines since pass 7's
baseline), `app/core/config.py` (+12 lines), `app/core/database.py`
(byte-identical — no diff at all since pass 7).
**Frontend:** none this pass — no frontend file in this feature's scope changed.
**Migrations:** none owned by these three files; a related finance-timestamp
backfill migration (`da76465bc3d2`) is covered below as the migration-side
counterpart of this pass's `config.py` change.

This is the rotation's eighth pass on Core Infrastructure, following
[`CI-33`](./CI-33-core-infra.md) (2026-08-31), [`CI2-33`](./CI2-33-core-infra.md),
[`CI3-33`](./CI3-33-core-infra.md), [`CI4-33`](./CI4-33-core-infra.md),
[`CI5-33`](./CI5-33-core-infra.md) (PR #2906), [`CI6-33`](./CI6-33-core-infra.md)
(PR #3084), and [`CI7-33`](./CI7-33-core-infra.md) (2026-10-18, PR #3393).
**0 fixes applied this pass, 0 new findings.**

---

## Scope

**Read in full, this pass:** a direct `git diff` of pass 7's merge commit
(`62d24e3e`, PR #3393) against current `main` for all three in-scope files.
`database.py` has zero lines of diff — confirmed with a dedicated
`git diff 62d24e3e..main -- backend/app/core/database.py`, which printed
nothing. The other two files' diff is 35 lines total, and every line of it
was read:

- **`config.py` (+12):**
  1. `get_db_connect_args()` gains `"init_command": "SET time_zone = '+00:00'"`.
     Every stored `DATETIME` is meant to be UTC (`_stamp_utc` in
     `database.py`), but `server_default=func.now()` runs in the session's
     time zone, which without this pins to the MySQL server's configured
     `TZ` (`America/New_York` in the shipped Compose files) — so a
     server-defaulted column like `created_at` was written in local
     wall-clock time while an application-written column like `approved_at`
     was written in UTC, hours apart on the same row. This `connect_args`
     dict is shared by both the async engine (`database.py:132`) and
     Alembic's sync engine (`alembic/env.py:187`, both call
     `settings.get_db_connect_args()`), so the fix applies identically to
     migrations and the app. Confirmed by reading `_db_credentials`/
     `DATABASE_URL`/`SYNC_DATABASE_URL` and both call sites — there is no
     third place a MySQL connection is opened without this helper.
     `init_command` is a genuine `pymysql`/`aiomysql` `Connection` kwarg (it
     is executed once per new physical connection, so it applies under
     pooling without needing a per-query `SET`). A companion migration
     (`20261018_1958_da76465bc3d2_finance_timestamps_to_utc.py`) backfills
     the finance rows written under the old behavior, converting from the
     server's recorded zone at the time, and a dedicated test
     (`test_finance_utc_backfill_migration.py`) and the feature-scoped
     `test_database_manager.py::test_connect_args_pin_the_session_time_zone_to_utc`
     both guard it. This closes a real, previously-silent correctness bug
     (not a security finding on its own) and is exactly the kind of fix this
     rotation wants to see applied with a guard test attached.
  2. `SESSION_ABSOLUTE_MAX_HOURS: int = Field(default=12, ge=0)` — a cap on
     total session lifetime regardless of activity, closing the gap where a
     session that keeps refreshing (e.g. a stolen cookie kept alive by a
     script) never had to re-authenticate. Read the consumer
     (`auth_service.py:session_end_reason`, lines ~155-176): both the idle
     limit (`HIPAA_SESSION_TIMEOUT_MINUTES`) and this new absolute limit are
     measured from server-written timestamps (`last_activity`,
     `created_at`), never from anything the client sends, and `0` turns the
     check off for either limit independently — the Pitfall #19 contract
     (a switch must have a real reader, and absence of configuration must
     mean the previous behavior, not silently "off") is satisfied: the
     default is `12`, not `0`, so a fresh install gets the cap without any
     action. `test_session_limits.py` exercises both the "still within
     bounds" and "past the absolute cap, independent of activity" paths, and
     a test explicitly pins the default to `12` so a change to it is a
     visible diff rather than a silent config drift.

- **`security_middleware.py` (+23/-3):**
  1. `_ExceptionCache` gains a module-level `invalidate_ip_exception_cache()`
     that clears the per-worker cache, called from two places:
     `ip_security_service.py:396` (the revoke-exception code path, alongside
     `publish_ip_exception_invalidation()` for the other workers) and
     `geoip_sync.py`'s `GeoIPInvalidationListener._handle`, which reacts to
     the same Redis pub/sub message on every other worker. Read
     `geoip_sync.py` in full: the invalidation message reuses the existing
     `geoip:invalidate` channel with a distinguishing payload
     (`IP_EXCEPTION_INVALIDATION = "ip-exceptions"`) rather than a second
     subscription, and a worker that doesn't recognize the payload (i.e. one
     still running the previous build, mid-rollout) falls through to the
     default branch and re-syncs blocked countries instead — harmless, not a
     security gap, since country-block re-sync already happens on a timer.
     Without Redis, only the acting worker's cache is cleared immediately
     and the others fall back to the existing 60s TTL — stated plainly in
     both the docstring and the code (`publish_ip_exception_invalidation`'s
     own docstring), not a silent gap. This closes the staleness window the
     class's own docstring used to admit for revocations specifically (the
     docstring previously said only "within `TTL_SECONDS`" for both
     directions; now a revocation is immediate across the whole fleet while
     an approval remains correctly bounded by the TTL — approvals are
     opt-in exceptions that affect a block widening, not narrowing, which
     doesn't carry the same urgency as closing a revoked exception fast).
  2. `IPBlockingMiddleware.BYPASS_PATHS` drops `/health/detailed`, leaving
     only `{"/health", "/"}`. Read the endpoint itself
     (`backend/main.py:2607-2641`): it is gated to
     `settings.ENVIRONMENT == "development"` (404 otherwise, same response
     as a route that doesn't exist) and reports CPU/memory/disk load plus a
     handful of boolean config flags — exactly the kind of host-fingerprint
     information a blocked IP or country must not be able to pull for free,
     so removing the IP-blocking bypass for it is the correct direction.
     This was fixed by commit `54fe07cd` ("security(core): stop
     /health/detailed stalling the event loop and bypassing IP blocks"),
     landed as ordinary engineering work before this pass started, not by
     this pass; verified by direct read rather than taken on the commit
     message. The same commit also fixed `psutil.cpu_percent(interval=1)`,
     which slept inside the event loop and stalled every other in-flight
     request for a second on every unauthenticated hit — confirmed gone;
     the live code reads `interval=None` (usage since the last call, `0.0`
     on the first), with a comment explaining why.
  3. `SecurityMonitoringMiddleware.EXPORT_ENDPOINTS` gains
     `/api/v1/finance/export/chart-of-accounts` and the templated
     `/api/v1/finance/export/logs/{log_id}/imported`. Verified both routes
     exist (`finance.py:4570-4710`: `GET`/`POST`/`DELETE` on
     `/export/chart-of-accounts` and `POST`/`DELETE` on
     `/export/logs/{log_id}/imported`) — this is the same class of addition
     CI4-33-1 fixed and guarded, and it is itself out of this feature's
     scope (the finance endpoints belong to Feature 05); only the
     monitoring-list entries themselves are this feature's concern. The two
     standing guard tests
     (`test_every_non_parameterized_export_route_is_covered` and
     `test_every_parameterized_export_route_is_matched` in
     `test_security_middleware.py`) both pass against the current OpenAPI
     schema (see Completion gate), so there is no drift in either
     direction — nothing in `EXPORT_ENDPOINTS` names a route that doesn't
     exist, and no actual export route is missing from the list.

**Not touched this pass, same exclusions as every prior pass:** `security.py`,
`cache.py`, `websocket_manager.py`, `encrypted_types.py`, `app/core/audit.py`
(Feature 28's scope), `app/core/permissions.py` (Feature 02's scope).

## Re-verification of prior findings

Both historical findings with open/corrected dispositions as of CI7-33
(CI3-33-3 and CI3-33-4) have their documented locations in `config.py`'s
`RETIRED_SETTINGS` block, which this pass's diff does not touch — re-confirmed
unaffected by a fresh `grep` for both names in `config.py`'s current content,
same block, same disposition. No other historical finding's documented
location falls inside this pass's 35-line diff either. Nothing to re-litigate.

## New code reviewed fresh

Covered in full under **Scope** above: the UTC `init_command` fix and its
migration/test pair, `SESSION_ABSOLUTE_MAX_HOURS` and its fail-closed, 0-means-off
reader, the cross-worker IP-exception cache invalidation, `/health/detailed`'s
removal from the IP-blocking bypass list, and the two new `EXPORT_ENDPOINTS`
entries. Nothing here is a new finding — these are closures of previously-real
gaps (the UTC timestamp bug, the `/health/detailed` IP-block bypass, the
revocation-propagation delay), not newly introduced ones.

## Verified good ✅

- **The UTC `init_command` applies to both the app engine and Alembic** —
  both `database.py:132` and `alembic/env.py:187` call the same
  `settings.get_db_connect_args()`, so there is no second, unpatched
  connection path into MySQL.
- **`SESSION_ABSOLUTE_MAX_HOURS` is measured server-side and fails open only
  when explicitly set to `0`** — `auth_service.py`'s `session_end_reason`
  reads `created_at`/`last_activity` from the row, never from client input,
  and the default (`12`) is nonzero, so a fresh install gets the cap without
  any configuration step (Pitfall #19).
- **IP-exception revocation now propagates to every worker within the pub/sub
  round-trip, not just the acting worker's own 60s TTL** — `geoip_sync.py`'s
  listener calls `invalidate_ip_exception_cache()` on every subscribed worker;
  the degraded case (no Redis) is stated in the docstring, not silently
  assumed.
- **`/health/detailed` is both IP-blocking-eligible and event-loop-safe** —
  confirmed by direct read of `backend/main.py:2607-2641`: `ENVIRONMENT !=
"development"` still 404s it, and it no longer calls
  `psutil.cpu_percent(interval=1)`.
- **`EXPORT_ENDPOINTS` has no drift, in either direction, against the live
  OpenAPI schema** — both guard tests pass (see Completion gate).
- **`BaseHTTPMiddleware` has zero real usages** in the three in-scope files
  (re-confirmed by fresh `grep -rn "BaseHTTPMiddleware"` — only documenting
  comments, unchanged from every prior pass).
- **`main.py`'s middleware stack, registration order, and both
  production/staging boot-blocking checks are unchanged** (re-confirmed by
  fresh `grep` for `add_middleware`/`validate_security_configuration`/the
  `SECRET_KEY` check — same call sites as pass 7).

## Findings

None new this pass. No historical finding's disposition changed.

## Schema & migration notes

No schema change in `config.py`/`security_middleware.py`/`database.py`
themselves this pass. The UTC `init_command` fix's migration-side
counterpart, `20261018_1958_da76465bc3d2_finance_timestamps_to_utc.py`, was
already reviewed and tested before this pass (it predates pass 7's merge
baseline) — re-confirmed idempotent and re-run clean in this pass's local
rebuild (see Completion gate: `test_finance_utc_backfill_migration.py`
passes, with its one pre-existing skip because the sandbox database records
`SYSTEM` as its time zone, not a named zone table).

**Environment note — `main` currently has forked Alembic heads, unrelated to
this feature.** At the time of this review, `origin/main`'s migration chain
has two heads (`33922563bb88`, `75a6edc2ae4a`), left by two independent merge
revisions from PR #3529 and PR #3531 landing within the same minute; PR #3546
is open to merge them. This pass touches no migration and introduces no new
head on its own. To run this pass's DB-backed tests and
`validate_migrations.py --strict` locally, PR #3546's single new migration
file (`20261021_2147_e5f9bb066e07_merge_heads.py`, a no-op merge of the two
forked heads) was temporarily copied into the local `alembic/versions/`
directory for the schema build and test run only, then removed before
committing — this PR's diff does not include that file, and does not depend
on PR #3546 merging first for its own tests to be meaningful, since the fork
is upstream of both equally. Re-running `validate_migrations.py --strict`
against `origin/main` as committed (without PR #3546's fix) reproduces the
2-head failure, as expected and unrelated to this change.

## Guard tests added

None by this pass — the relevant guard tests
(`test_every_non_parameterized_export_route_is_covered`,
`test_every_parameterized_export_route_is_matched`,
`test_connect_args_pin_the_session_time_zone_to_utc`, `test_session_limits.py`,
`test_finance_utc_backfill_migration.py`) already exist from the commits that
introduced the invariants they check, and all are re-confirmed passing below.

## Completion gate

| Check                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Result                                                                            |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `flake8 app/ tests/ alembic/` (7.4.1, CI's pin)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | ✅ 0 violations                                                                   |
| `black --check app/ tests/ alembic/` (26.10.1)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | ✅ clean, 2,552 files unchanged                                                   |
| `isort --check-only app/ tests/ alembic/` (9.0.2)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | ✅ clean                                                                          |
| `python3 scripts/validate_migrations.py --strict` (with PR #3546's merge migration temporarily applied locally, per the note above)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | ✅ 639 revisions, single head `e5f9bb066e07`                                      |
| Feature-scoped tests (`test_security_middleware.py`, `test_core_infra_boot_checks.py`, `test_database_manager.py`, `test_database_url_encoding.py`, `test_onboarding_rate_limit_scopes.py`, `test_startup_diagnostics.py`, `test_tls_required_config.py`, `test_openapi_contract.py`, `test_email_link_domain.py`, `test_install_sh_frontend_url.py`, `test_installer_frontend_url.py`, `test_unlogged_paths.py`, `test_nginx_config_consistency.py`, `test_config_retired_settings.py`, `test_compose_settings_passthrough.py`, `test_ip_allowlist_middleware.py`, `test_security_alert_workflow.py`, `test_session_limits.py`, `test_finance_utc_backfill_migration.py`) | ✅ 737 passed, 1 skipped (pre-existing, sandbox DB has no named time-zone tables) |
| Cross-cutting guard tests (`test_like_escaping.py`, `test_csv_writer_sweep.py`, `test_database_schema.py`, `test_org_scoping_ratchet.py`, `test_capacity_locking.py`, `test_endpoint_auth_coverage.py`, `test_api_cache_pii_exclusions.py`, `test_migration_create_all_tables.py`, `test_baseline_member_grants.py`, `test_alembic_migrations.py`, `test_account_status_gates.py`)                                                                                                                                                                                                                                                                                         | ✅ 241 passed                                                                     |
| `cd frontend && npm run typecheck` (aliased TS 7.0.2, the actual build compiler)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | ✅ 0 errors                                                                       |
| `cd frontend && npm run lint` (eslint, max-warnings 10)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | ✅ 0 errors, 0 warnings                                                           |

**Environment note:** backend tooling (`flake8`/`black`/`isort`/`pytest`) is
installed under `/usr/bin/python3` (3.13); the `/usr/local/bin/python3` on
`PATH` ahead of it resolves to a bare 3.11 with no project dependencies, so
every tool invocation in this pass used `/usr/bin/python3 -m pytest` (or the
project-installed console scripts directly) explicitly rather than a bare
`python3`/`pytest`, to avoid a false "module not found" that is an
interpreter-selection problem, not a dependency gap. MariaDB and Redis were
already running in this sandbox; `intranet_db` was dropped and recreated with
`utf8mb4_unicode_ci` (per CLAUDE.md's startup-hook guidance) before the
schema build, since a prior session had left it in an inconsistent state.
