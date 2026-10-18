# Security Review — Feature 33: Core Infrastructure (pass 7)

**Prefix:** `CI7` · **Iteration:** 33 · **Reviewed:** 2026-10-18 · **PR:** (recorded after open)

**Backend:** `app/core/security_middleware.py` (byte-identical line count to
pass 6 except the two lines below), `app/core/config.py` (+26 lines — two new
settings), `app/core/database.py` (type-annotation-only change).
**Frontend:** none this pass — no frontend file in this feature's scope changed.
**Migrations:** none — no schema change in these three files.

This is the rotation's seventh pass on Core Infrastructure, following
[`CI-33`](./CI-33-core-infra.md) (2026-08-31), [`CI2-33`](./CI2-33-core-infra.md)
(2026-08-27), [`CI3-33`](./CI3-33-core-infra.md) (2026-09-07),
[`CI4-33`](./CI4-33-core-infra.md) (2026-09-13), [`CI5-33`](./CI5-33-core-infra.md)
(2026-10-04, PR #2906), and [`CI6-33`](./CI6-33-core-infra.md) (2026-10-11,
PR #3084). **0 fixes applied this pass, 0 new findings.** One standing item,
**CI3-33-4** (LOW), is now confirmed resolved — not by this pass, but by
engineering work that in fact landed _before_ CI6 merged; CI6's "still open"
disposition for it was itself stale at the time it was written (see below).

---

## Scope

**Read in full, this pass:** a direct `git diff` of pass 6's merge commit
(`b00f5da3`, PR #3084) against current `main` for all three in-scope files.
The diff is small — 40 lines total across the three files — and every line of
it was read:

- `config.py`: +26/-0 — two new settings, `CALENDAR_SYNC_ENABLED: bool = False`
  and `GOOGLE_CALENDAR_REDIRECT_URI` / `MICROSOFT_CALENDAR_REDIRECT_URI`
  (`str | None = None`), for a one-way department-calendar publishing feature.
- `database.py`: +6/-2 — `DatabaseManager.engine`/`.session_factory` gain
  explicit `Optional[AsyncEngine]` / `Optional[async_sessionmaker[AsyncSession]]`
  annotations (mypy cleanup, confirmed via `git log -S`:
  commit `668fca63`, "Fix mypy errors in core, utils, schemas, mcp and
  integration services" — no control-flow change).
- `security_middleware.py`: +5/-1 —
  1. `verify_csrf_token`'s safe-method check changed from
     `request.method in {...}` to `request.scope["method"] in {...}`
     (same commit `668fca63`). Starlette's `Request.method` property reads
     `self.scope["method"]` directly, so this is behavior-identical — a
     typing-driven rewrite, not a logic change.
  2. `SecurityMonitoringMiddleware.EXPORT_ENDPOINTS` gained four entries
     (`/api/v1/finance/export/advance-accounts`,
     `/api/v1/finance/export/dues-accounts`,
     `/api/v1/medical-supplies/items/export`,
     `/api/v1/medical-supplies/lots/export`). This is the exact class of
     change CI4-33-1 fixed and guarded — **already reviewed under Feature 28
     (Security/audit/IP) pass 7** (PR #3376, 2026-10-17, which added these
     same four routes and their monitoring entries together), not re-reviewed
     here to avoid duplicate coverage. Re-verified via the standing guard
     test (`test_every_non_parameterized_export_route_is_covered` /
     `test_every_parameterized_export_route_is_matched` in
     `test_security_middleware.py`) — both pass, so `EXPORT_ENDPOINTS` has no
     drift against the current OpenAPI schema in either direction.

**New consumers of this feature's settings, spot-checked but not fully
reviewed** (same methodology as CI5-33/CI6-33's treatment of Authentik/MCP
OAuth): `CALENDAR_SYNC_ENABLED` and the two redirect-URI settings are read by
`app/services/calendar_sync_service.py`, `scheduled_tasks.py`'s
`calendar_sync` task, `calendar_oauth_common.py`, and the new
`app/api/v1/endpoints/google_calendar_oauth.py` /
`outlook_calendar_oauth.py`. All four have real readers (Pitfall #19 is
satisfied — the switch defaults `False` and every reader checks it before
acting) and the OAuth endpoints are out of this feature's declared scope
(they belong to Feature 27, Integrations, or a not-yet-created feature for
this specific integration). Spot-checked only: `/oauth/start` requires
`integrations.manage`; `/oauth/callback` is intentionally unauthenticated
(Google's redirect may arrive after the session lapsed) but re-verifies the
administrator still holds `integrations.manage` before completing the
connection (`calendar_oauth_common.py:247`, `user_has_permission`), binds the
attempt to the organization via a signed `state` plus a double-submitted,
`httponly`, path-scoped nonce cookie, and the pending attempt is single-use.
This is not a full review of the calendar-OAuth feature — a future pass on
Feature 27 or a dedicated feature should do that — but nothing here
contradicts the settings' own fail-closed contract.

**Not touched this pass, same exclusions as every prior pass:** `security.py`,
`cache.py`, `websocket_manager.py`, `encrypted_types.py`, `app/core/audit.py`
(Feature 28's scope), `app/core/permissions.py` (Feature 02's scope).

## Re-verification of prior findings

All 30 historical findings across CI-33/CI2-33/CI3-33/CI4-33 that CI5-33 and
CI6-33 re-verified correct are unaffected by this window's 40-line diff — none
of their documented locations fall inside the changed lines (the CSRF check
and `EXPORT_ENDPOINTS` list are the only touched regions with any finding
history, and both are addressed above).

| id                                                                                                      | pass 6 disposition          | this pass                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ------------------------------------------------------------------------------------------------------- | --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CI3-33-3 (HIGH — `REGISTRATION_REQUIRES_APPROVAL` has no reader)                                        | fixed (pass 6)              | **✅ Still fixed.** Re-confirmed: the name does not exist as a `Settings` field; it is a `RETIRED_SETTINGS` key, popped with a warning. No change this window.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| CI3-33-4 (LOW — `RATE_LIMIT_PER_MINUTE`, `MAX_FILE_SIZE`, `STORAGE_TYPE`, `DB_POOL_MIN` have no reader) | **"still open, unchanged"** | **✅ Resolved — and was already resolved when CI6 was written.** All four names (plus `UPLOAD_DIR`) are `RETIRED_SETTINGS` keys in `config.py`, not live fields — `grep` for each name across `app/`, `scripts/`, `alembic/` outside `config.py` returns 0 hits, and `config.py` itself shows them only inside the retirement dict with "Retired 2026-10-08 (CI3-33-4)" comments. `git log -S` on that retirement block resolves to commit `9982a1ab`, timestamped 2026-10-11 14:43 UTC — **before** CI6's own merge commit `b00f5da3` (2026-10-11 22:01 UTC). CI6's "still open" disposition was therefore stale at the moment it was recorded, most likely because its diff was taken against an earlier working-tree snapshot than its merge. `docs/KNOWN_LIMITATIONS.md`'s row for this item already says "✅ Resolved" with the 2026-10-08 date and is accurate; no edit needed there. This correction is recorded here so a later pass doesn't re-flag it as open on CI6's say-so. |

## New code reviewed fresh

Covered in **Scope** above (the CSRF check's typing-only rewrite, the
`EXPORT_ENDPOINTS` additions already reviewed under Feature 28, the two
`database.py` type annotations, and the new calendar settings' readers).
Nothing here is a new finding.

## Verified good ✅

- **`database.py`'s actual behavior is unchanged** — the diff adds only type
  annotations (`Optional[AsyncEngine]`, `Optional[async_sessionmaker[...]]`);
  confirmed by reading every changed line, none of which touches control
  flow.
- **The CSRF safe-method check is behavior-identical** before and after —
  `request.method` and `request.scope["method"]` read the same value;
  Starlette's `Request.method` property is a direct passthrough to
  `self.scope["method"]`.
- **`EXPORT_ENDPOINTS` has no drift**, in either direction, against the
  live OpenAPI schema — `test_every_non_parameterized_export_route_is_covered`
  and `test_every_parameterized_export_route_is_matched` both pass (see
  Completion gate).
- **The two new calendar redirect-URI settings and the sync-enable flag all
  have real, fail-closed readers** — named above, with file/line evidence.
- **`BaseHTTPMiddleware` has zero real usages** in the three in-scope files
  (re-confirmed by fresh `grep -rn "BaseHTTPMiddleware"` — only documenting
  comments, unchanged from every prior pass).
- **`main.py`'s middleware stack, registration order, and both
  production/staging boot-blocking checks are unchanged** (re-confirmed by
  fresh `grep` for `add_middleware`/`validate_security_configuration`/the
  `SECRET_KEY` check — same call sites as pass 6).

## Findings

None new this pass. CI3-33-4 (LOW) moves from "open" (per CI6's stale
disposition) to **confirmed resolved**, as detailed in the re-verification
table above — this is a correction to the historical record, not a new fix
applied by this pass.

## Schema & migration notes

n/a — no schema-touching change in this feature's scope this pass. Alembic
chain re-validated: 618 revisions, single head `1117b642643b`, no duplicate
ids (`validate_migrations.py --strict`).

## Guard tests added

None by this pass — the relevant guard tests
(`test_every_non_parameterized_export_route_is_covered`,
`test_every_parameterized_export_route_is_matched`,
`test_config_retired_settings.py`) already exist from the commits that
introduced the invariants they check, and both are re-confirmed passing
below.

## Completion gate

| Check                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Result                                           |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------ |
| `flake8 app/ tests/ alembic/` (7.3.0, CI's pin)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | ✅ 0 violations                                  |
| `black --check app/ tests/ alembic/` (26.5.1)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | ✅ clean, 2,426 files unchanged                  |
| `isort --check-only app/ tests/ alembic/` (9.0.1)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | ✅ clean                                         |
| `python3 scripts/validate_migrations.py --strict`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | ✅ 618 revisions, single head `1117b642643b`     |
| Feature-scoped tests (`test_security_middleware.py`, `test_core_infra_boot_checks.py`, `test_database_manager.py`, `test_database_url_encoding.py`, `test_onboarding_rate_limit_scopes.py`, `test_startup_diagnostics.py`, `test_tls_required_config.py`, `test_openapi_contract.py`, `test_email_link_domain.py`, `test_install_sh_frontend_url.py`, `test_installer_frontend_url.py`, `test_unlogged_paths.py`, `test_nginx_config_consistency.py`, `test_config_retired_settings.py`, `test_compose_settings_passthrough.py`, `test_ip_allowlist_middleware.py`, `test_security_alert_workflow.py`) | ✅ 702 passed                                    |
| Cross-cutting guard tests (`test_like_escaping.py`, `test_csv_writer_sweep.py`, `test_database_schema.py`, `test_org_scoping_ratchet.py`, `test_capacity_locking.py`, `test_endpoint_auth_coverage.py`, `test_api_cache_pii_exclusions.py`, `test_migration_create_all_tables.py`, `test_baseline_member_grants.py`)                                                                                                                                                                                                                                                                                   | ✅ 206 passed                                    |
| New-consumer spot-check tests (`-k "calendar_sync or google_calendar or outlook_calendar"`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | ✅ 167 passed, 1 pre-existing skip (`pywebpush`) |
| `cd frontend && npm run typecheck` (aliased TS 7.0.2, the actual build compiler)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | ✅ 0 errors                                      |
| `cd frontend && npm run lint` (eslint, max-warnings 10)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | ✅ 0 errors, 0 warnings                          |

**Environment note:** this sandbox's `frontend/node_modules` was not yet
populated at the start of this pass (only backend dependencies are installed
by `.claude/hooks/session-start.sh`); `npm run typecheck` initially failed on
`Cannot find module '@tiptap/react'`/`'@tiptap/starter-kit'` — a missing
dependency, not a code defect. Running `npm ci` from the repo root (per
CLAUDE.md's package-manager convention — never `rm package-lock.json && npm
install`) resolved it; `npm run typecheck` is clean against the committed
lockfile with no changes to `package.json` or `package-lock.json`. Backend
`flake8`/`black`/`isort` were re-pinned to CI's exact versions before running.
MariaDB and Redis were already running in this sandbox.
