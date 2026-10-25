# Security Review — Feature 33: Core Infrastructure (pass 9)

**Prefix:** `CI9` · **Iteration:** 33 · **Reviewed:** 2026-10-25 · **PR:** (recorded after open)

**1 fixed this pass** (CI9-33-1, a repo-wide tooling drift flagged by two
earlier passes), **0 new findings.**

**Backend:** `app/core/config.py` (+46/-2 lines since pass 8's baseline),
`app/core/security_middleware.py` (+2 lines). `app/core/database.py` is
byte-identical — confirmed with a dedicated
`git diff 77ea4c15..HEAD -- backend/app/core/database.py`, which printed nothing.
**Frontend:** none this pass — no frontend file in this feature's scope changed.
**Migrations:** none owned by these three files; no new migration this pass
touches `config.py`/`security_middleware.py`/`database.py`'s concerns.

This is the rotation's ninth pass on Core Infrastructure, following
[`CI-33`](./CI-33-core-infra.md) (2026-08-31) through
[`CI8-33`](./CI8-33-core-infra.md) (2026-10-21, PR #3547). A watchdog pickup —
the dedicated loop session for this rotation
(`session_011T1ZyyLrD5HagusgK9uDw2`) remains unreachable (no agent via
`ListAgents` either). PR #3677 (Feature 32, Locations & kiosk, pass 9) had
already merged with no open rotation PR behind it — confirmed via both
`search_pull_requests` (`head:claude/security-review-`, state=open) and
`list_pull_requests` (state=open), 0 results both times, re-checked
immediately before branching. **1 fixed this pass, 0 new findings.**

---

## Scope

**Read in full, this pass:** a direct `git diff` of pass 8's merge commit
(`77ea4c15`, PR #3547) against current `main` for all three in-scope files.
`database.py` has zero lines of diff. The other two files' diff is 48 lines
total, and every line of it was read, together with every new setting's
consumer outside this feature's three files (Pitfall #19 requires a reader to
exist; it does not require the reader to live in one of these three files):

- **`config.py` (+46/-2):**
  1. `RETIRED_SETTINGS["STORAGE_TYPE"]`'s explanation text updated from "there
     is no S3/Azure/GCS backend" to describe the now-existing per-org File
     Storage S3 setting — a doc correction tracking a feature that landed
     elsewhere, not a behavior change.
  2. `DB_SSL_CERT`/`DB_SSL_KEY` and `REDIS_SSL_CERT`/`REDIS_SSL_KEY` — mutual
     TLS client certificate settings for MySQL and Redis. Traced both
     consumers: `get_db_connect_args()` calls
     `ssl_ctx.load_cert_chain(self.DB_SSL_CERT, self.DB_SSL_KEY or None)` only
     when `DB_SSL_CERT` is set; `core/cache.py:70-73` sets `ssl_certfile`/
     `ssl_keyfile` the same way for Redis. Both are read from paths an
     operator configures, not client input. `preflight.py`'s
     `_unreadable_ca_paths()` already checked both pairs' file readability
     before this pass (pre-existing, symmetric for DB and Redis).
  3. A new `validate_security_config()` check: `CRITICAL` if exactly one of
     each cert/key pair is set. The field comments state the contract
     explicitly ("Both or neither"), so this isn't a false positive against a
     combined-PEM use case — the design intentionally requires two separate
     files, and the `or None` in `get_db_connect_args` exists only to avoid
     passing an empty string as a path, not to support a combined file. A
     half-configured pair would otherwise fail later as a confusing
     connection-time TLS error instead of a clear boot-time message; this
     closes that gap. Verified this reaches `validate_security_configuration()`
     in `main.py` and blocks boot in `production`/`staging` like every other
     `CRITICAL` line (`main.py:1404`). `test_tls_setup.py` (lines ~620-670)
     covers both the matched and mismatched pairs for both DB and Redis.
  4. `SESSION_KIOSK_ABSOLUTE_MAX_HOURS` / `SESSION_KIOSK_IDLE_TIMEOUT_MINUTES`
     — longer session limits for a station kiosk, gated behind the
     `security.kiosk_session` permission. Traced the full path:
     `POST /auth/session/kiosk` requires the permission
     (`require_permission("security.kiosk_session")`) and acts only on the
     **caller's own** current session (`_set_session_kiosk` rejects a
     session whose `user_id` doesn't match `current_user.id`);
     `DELETE /auth/session/kiosk` needs no permission (narrowing a session is
     always safe). Enforcement never trusts the stored `is_kiosk` flag by
     itself: `AuthService.holds_kiosk_session()` re-checks the permission
     live on every refresh (`auth_service.py:594-598`) and every token
     validation (`auth_service.py:1034-1038`), so a member whose permission is
     revoked drops to the standard limits on their very next request, not at
     next login. Both limits are measured server-side
     (`session.created_at`/`last_activity`), `0` disables either
     independently, and the nonzero defaults (168h / 720min) mean a fresh
     install gets a cap without any action (Pitfall #19). The action is
     audited (`kiosk_session_enabled`/`disabled`, severity `warning` on
     enable). `test_session_limits.py` exercises both limits and the
     permission-revocation-mid-session path.
  5. `MFA_GRACE_DAYS` — a grace period before MFA enrollment is enforced for
     privileged members (`mfa_policy.PRIVILEGED_PERMISSIONS`, a fixed
     permission list, OR-matched including wildcards). `grace_expired()`
     reads a server-written `started_at`; an unstarted clock is correctly
     treated as _not_ expired (so a member never seen before isn't locked out
     on the first post-upgrade request) while `MFA_GRACE_DAYS == 0` closes the
     gate immediately for that same unstarted case — the two are distinct
     branches, not a shared fallthrough, so a `0` setting doesn't silently
     mean "never expires" for a member the clock never started on.
     `test_mfa_policy.py` pins the privileged-permission list and both grace
     branches.
  6. `STEPUP_WINDOW_MINUTES` — how long a `POST /auth/step-up` re-verification
     keeps `require_stepup`-gated routes open. `_stepup_is_fresh()` reads
     `stepup_verified_at` off the session row (server-written, never from
     client input) and the dependency's own docstring states it must be added
     **after** the route's permission dependency, so a caller lacking the
     permission is told that rather than asked to re-verify — confirmed by two
     existing guard tests, `test_step_up_is_on_exactly_the_documented_handlers`
     and `test_step_up_always_follows_the_permission_check`, both of which
     pass (see Completion gate).
  7. `S3_ALLOW_PRIVATE_ENDPOINT` — an operator-level risk acceptance (default
     `False`) letting a department's own configured S3 endpoint resolve to a
     private address or use plain HTTP, read by `s3_storage.py:189` before any
     such destination is accepted and surfaced read-only to the org via
     `GET` on `organizations.py:658`. Same shape as the existing
     `AUDIT_SHIP_ALLOW_PRIVATE_DESTINATION` pattern: the endpoint is typed by a
     department administrator, not the operator, so defaulting closed is the
     correct direction (an open default would let a tenant administrator point
     signed requests at an internal service). `test_s3_storage.py` covers the
     gate.

- **`security_middleware.py` (+2):** two new `EXPORT_ENDPOINTS` entries,
  `/api/v1/inventory/nfc-tags/export` and `/api/v1/nfc-tags/taps/export`.
  Verified both routes exist at exactly those paths: `inventory_nfc.py:658`
  (`GET /nfc-tags/export`, mounted under `/inventory`) and `nfc_tags.py:137`
  (`GET /taps/export`, mounted under `/nfc-tags`). Both standing guard tests
  (`test_every_non_parameterized_export_route_is_covered`,
  `test_every_parameterized_export_route_is_matched`) pass against the
  current OpenAPI schema — no drift in either direction. The routes
  themselves belong to Apparatus & NFC (feature 13, currently `✅`); only the
  monitoring-list entries are this feature's concern.

**Not touched this pass, same exclusions as every prior pass:** `security.py`,
`cache.py` (beyond the one new Redis-cert read noted above), `websocket_manager.py`,
`encrypted_types.py`, `app/core/audit.py` (Feature 28's scope), `app/core/permissions.py`
(Feature 02's scope).

## Re-verification of prior findings

Both historical findings with open/flagged dispositions as of CI8-33 (CI-9's
three ops/config items — DB/Redis TLS WARN-only in prod, `optimize_image`
fail-open, Redis `CERT_NONE` without a configured CA — and CI-10's residual
items — no cache tenant namespacing, WS `accept()` before auth, MFA recovery
codes 40-bit unsalted SHA-256) live in `security.py`/`cache.py`/
`websocket_manager.py`/`encrypted_types.py`, none of which this pass's 48-line
diff touches — re-confirmed unaffected by reading each item's named location
fresh. Nothing to re-litigate.

## New code reviewed fresh

Covered in full under **Scope** above: the DB/Redis mutual-TLS cert settings
and their matched-pair validation, kiosk session limits and their
live-permission-recheck enforcement, the MFA enrollment grace period, the
step-up re-verification window, the new `S3_ALLOW_PRIVATE_ENDPOINT` operator
gate, and the two new `EXPORT_ENDPOINTS` entries. Nothing here is a new
finding — every new setting has a real reader, fails toward the safer
direction by default, and is covered by an existing or already-updated test.

## Verified good ✅

- **The DB/Redis client-cert pairing check matches the documented contract**
  — both field comments say "both or neither", the new `CRITICAL` fires on a
  mismatch and blocks boot in production/staging (`main.py:1404`), and
  `test_tls_setup.py` exercises matched and mismatched pairs for both
  services.
- **A kiosk session is re-authorized on every request, not just at login** —
  `AuthService.holds_kiosk_session()` is called from both the refresh path
  (`auth_service.py:594-598`) and the access-token validation path
  (`auth_service.py:1034-1038`), so a revoked `security.kiosk_session`
  permission drops the session to standard limits on its very next use.
- **`/auth/session/kiosk` enable is self-scoped and permission-gated; disable
  is open** — `_set_session_kiosk` rejects any session not owned by the
  caller, `POST` requires the permission, `DELETE` does not (narrowing a
  session can never need a permission check).
- **MFA grace correctly distinguishes "never started" from "expired"** —
  `grace_expired(None, now)` returns `MFA_GRACE_DAYS == 0` rather than always
  `False`, so a `0`-day grace setting still closes the gate for a
  never-before-seen privileged member instead of leaving it permanently open.
- **`require_stepup` cannot be reached by someone who merely holds the
  permission-less route** — it is documented and tested to run strictly after
  the route's own permission dependency, confirmed by
  `test_step_up_always_follows_the_permission_check`.
- **`EXPORT_ENDPOINTS` has no drift, in either direction, against the live
  OpenAPI schema** — both guard tests pass (see Completion gate).
- **`BaseHTTPMiddleware` has zero real usages** in the three in-scope files
  (re-confirmed by fresh `grep -rn "BaseHTTPMiddleware"` — only documenting
  comments, unchanged from every prior pass).

## Findings

### CI9-33-1 — LOW (tooling, not application-facing) — Backend Lint's pinned `flake8`/`isort`/`black` had drifted from `requirements.txt` for the third time — ✅ FIXED

**What:** `.github/workflows/ci.yml`'s Backend Lint job pinned
`flake8==7.3.0`/`black==26.5.1`/`isort==9.0.1` explicitly, while
`backend/requirements.txt`'s Code Quality block had moved to
`flake8==7.4.1`/`black==26.10.1`/`isort==9.0.2`. First flagged (flake8/isort
only) during security review SF-04 pass 8 (2026-10-12); `black` drifted too
by this pass, after `requirements.txt` moved again.
**Where:** `.github/workflows/ci.yml:121` vs `backend/requirements.txt:171-182`.
**Failure scenario:** a developer runs `pip install -r requirements.txt`
then `flake8`/`black`/`isort` locally and gets a clean result on code that
CI's differently-pinned toolchain would flag, or vice versa — exactly the
"CI was green against a toolchain no developer actually ran" failure the
workflow step's own comment already warns about for the prior two
incidents.
**Impact:** no application code is wrong; the risk is a false-clean local
check or a spurious CI-only failure from a lint rule that changed between
the two pinned versions.
**Fix:** re-ran `flake8`/`black`/`isort` at `requirements.txt`'s versions
(7.4.1/26.10.1/9.0.2) against the full `app/ tests/ alembic/` tree — clean,
identically to the older pins — then bumped `.github/workflows/ci.yml`'s
pin to match `requirements.txt` rather than reverting `requirements.txt`
backward, so a future Dependabot-style forward bump of the linters doesn't
have to fight this pin a fourth time. `KNOWN_LIMITATIONS.md`'s CI-1 entry
marked resolved.

No other historical finding's disposition changed this pass.

## Schema & migration notes

No schema change in `config.py`/`security_middleware.py`/`database.py`
themselves this pass, and no migration added in this window touches any of
the three files' concerns. `validate_migrations.py --strict` reports a single
head (`3d67883cd461`, 651 revisions) — no forked-head repeat of the CI8-33
incident.

## Guard tests added

None by this pass — every invariant checked above already has a guard test
from the commit that introduced it (`test_tls_setup.py`,
`test_session_limits.py`, `test_mfa_policy.py`, `test_s3_storage.py`,
`test_every_non_parameterized_export_route_is_covered`,
`test_every_parameterized_export_route_is_matched`), all re-confirmed passing
below.

## Completion gate

| Check                                                                                                                                                                                                                                                                                                                                                                                | Result                                                         |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------- |
| `flake8 app/ tests/ alembic/` (7.4.1, CI's pin as of this pass's fix)                                                                                                                                                                                                                                                                                                                | ✅ 0 violations                                                |
| `black --check app/ tests/ alembic/` (26.10.1, CI's pin as of this pass's fix)                                                                                                                                                                                                                                                                                                       | ✅ clean, 2,636 files unchanged                                |
| `isort --check-only app/ tests/ alembic/` (9.0.2, CI's pin as of this pass's fix)                                                                                                                                                                                                                                                                                                    | ✅ clean                                                       |
| `python3 scripts/validate_migrations.py --strict`                                                                                                                                                                                                                                                                                                                                    | ✅ 651 revisions, single head `3d67883cd461`                   |
| Feature-scoped tests (`test_security_middleware.py`, `test_core_infra_boot_checks.py`, `test_database_manager.py`, `test_database_url_encoding.py`, `test_tls_setup.py`, `test_session_limits.py`, `test_mfa_policy.py`, `test_s3_storage.py`, `test_openapi_contract.py`, `test_config_retired_settings.py`, `test_compose_settings_passthrough.py`, `test_startup_diagnostics.py`) | ✅ 507 passed, 1 skipped (pre-existing, "root reads any file") |
| Cross-cutting guard tests (`test_like_escaping.py`, `test_csv_writer_sweep.py`, `test_database_schema.py`, `test_org_scoping_ratchet.py`, `test_capacity_locking.py`, `test_endpoint_auth_coverage.py`, `test_api_cache_pii_exclusions.py`, `test_migration_create_all_tables.py`, `test_baseline_member_grants.py`, `test_alembic_migrations.py`, `test_account_status_gates.py`)   | ✅ 242 passed                                                  |
| `cd frontend && npm run typecheck`                                                                                                                                                                                                                                                                                                                                                   | n/a — no frontend file touched this pass                       |
| `cd frontend && npm run lint`                                                                                                                                                                                                                                                                                                                                                        | n/a — no frontend file touched this pass                       |

**Environment note:** backend tooling (`flake8`/`black`/`isort`) is installed
under `/usr/bin/python3` (3.13); `/usr/local/bin/python3` on `PATH` ahead of it
resolves to a bare interpreter with no project dependencies, so every tool
invocation in this pass used `/usr/bin/python3 -m <tool>` explicitly. Discovering
CI's pinned linter versions (7.3.0/26.5.1/9.0.1) differed from the versions
already present in this sandbox (7.4.1/26.10.1/9.0.2, matching
`backend/requirements.txt`) is what surfaced CI9-33-1 above; both version sets
were run against the full tree and both are clean (see Findings), and the gate
results recorded in the table below are from CI's now-updated pin.
