# Security Review — Feature 33: Core Infrastructure (pass 6)

**Prefix:** `CI6` · **Iteration:** 33 · **Reviewed:** 2026-10-11 · **PR:** (recorded after open)

**Backend:** `app/core/security_middleware.py` (1,868 L, up from pass 5's
1,741 L), `app/core/config.py` (1,514 L, up from pass 5's 1,341 L —
substantial growth, reviewed below), `app/core/database.py` (287 L,
**byte-identical to pass 5** — confirmed by direct diff, not re-read).
**Frontend:** none this pass — no frontend file in this feature's scope changed.
**Migrations:** none — no schema change in these three files.

This is the rotation's sixth pass on Core Infrastructure, following
[`CI-33`](./CI-33-core-infra.md) (2026-08-31), [`CI2-33`](./CI2-33-core-infra.md)
(2026-08-27), [`CI3-33`](./CI3-33-core-infra.md) (2026-09-07),
[`CI4-33`](./CI4-33-core-infra.md) (2026-09-13), and
[`CI5-33`](./CI5-33-core-infra.md) (2026-10-04, PR #2906). **0 fixes applied
this pass, 0 new findings.** One previously-FLAGGED item (CI3-33-3, HIGH) is
re-verified **now fixed** — by code that landed on `main` since pass 5, not by
this pass — and the remaining flagged item (CI3-33-4, LOW) is re-confirmed
still open, unchanged.

---

## Scope

**Read in full, this pass:** a direct `git diff` of pass 5's merge commit
(`29675a3a`, PR #2906) against current `main` for all three in-scope files —
606 commits landed in that window. `database.py`'s diff is **empty**
(confirmed by `git diff --stat`, not assumed from a commit-touching-the-path
list, which for this file returns a false positive — see below). The other
two files' diffs are non-trivial and were read in full:

- `security_middleware.py`: +221/-54 lines across several independent
  changes — a new rate-limit scope for the password-reset token
  (`rate_limit_password_reset_token`), mypy-driven type-annotation tightening
  (no logic change), a bounded `_ExceptionCache` + `_has_ip_exception` adding
  a per-tenant-free IP allowlist exception to `IPBlockingMiddleware`'s
  country block (owner decision INT2-28), a new `_route_template_pattern`
  helper closing the templated-export-route gap `SecurityMonitoringMiddleware`
  documented as a known limitation, and a rewrite of the export-monitoring
  block from a `Content-Length`-header read (which a `StreamingResponse`
  never sets) to counting actual streamed bytes, plus a new per-export audit
  log row.
- `config.py`: +187/-57 (net) — a `RETIRED_SETTINGS` mechanism that
  **removes** `REGISTRATION_REQUIRES_APPROVAL` (closing CI3-33-3, see below)
  and `REFRESH_ROTATION_GRACE_SECONDS` (an unrelated, already-dead setting
  from a removed feature) while still accepting and warning on either name in
  an existing `.env`; a new `HIPAA_PASSWORD_EXPIRY_GRACE_DAYS` setting (has
  readers — see below); ClamAV scanning config (`CLAMAV_ENABLED`/`_HOST`/
  `_PORT`/`_TIMEOUT_SECONDS`, fails closed, part of the file-storage-hardening
  feature); a new Authentik OIDC provider's settings block; a new MCP OAuth
  2.1 authorization-server settings block plus its `mcp_oauth_origin()`
  validator; and two new `model_validator(mode="before")` hooks
  (`_drop_retired_settings`, `_empty_optional_string_means_unset`).

**A false lead in the commit history, resolved and recorded so a later pass
doesn't re-hit it:** `git log -- <path>` for the three in-scope files reports
a commit `b70c035c` ("fix(elections): refuse unknown keys...") as touching
all three files with thousands of insertions and zero deletions.
`git rev-list --parents -1 b70c035c` shows it has **no parent** — a graft/
history-join artifact unrelated to its stated content (the repo's history
contains an explicit "Join the three merges of the admin hours fork" commit
elsewhere, consistent with a history-stitching operation). Diffing it against
its claimed parent fails (`bad revision`). This is a git-plumbing artifact,
not three files actually rewritten by an elections fix; the actual diff
(`git diff 29675a3a HEAD -- <paths>`, direct content comparison, immune to
this artifact) is what this pass's findings are based on, and the real
`RETIRED_SETTINGS` commit's authorship is unresolved past that artifact. Not
pursued further — the code state on `main` is what matters, and it is
captured above.

**Re-verified by fresh grep, not re-read line-by-line a sixth time** (matching
prior passes' precedent for an unchanged file, extended to the unchanged
remainder of a changed one): `BaseHTTPMiddleware` usage (0 real, same
documenting comments), `main.py`'s middleware registration order (unchanged:
`SecurityHeadersMiddleware` → `TrustedHostMiddleware` →
`SecurityMonitoringMiddleware`/`IPBlockingMiddleware`/`IPLoggingMiddleware` →
`CORSMiddleware` → `GZipMiddleware` → `RequestSizeLimitMiddleware`), the
wildcard-CORS-with-credentials and `SECRET_KEY`-minimum-length boot blocks in
`main.py` (`validate_security_configuration()`, both still present, still
raise), and the `RateLimiter`/`_KeyState` internals CI3-33's 10 findings cover
(untouched by this window's diff — confirmed the diff contains no reference to
`_KeyState`, `_saturation_reject_until`, or any `RateLimiter` method).

**Not touched this pass, same exclusions as every prior pass:** `security.py`,
`cache.py`, `websocket_manager.py`, `encrypted_types.py`, `app/core/audit.py`
(Feature 28's scope), `app/core/permissions.py` (Feature 02's scope).

**New consumers of this feature's settings, cross-referenced not fully
reviewed** (same methodology as CI5-33's spot-check of `branding.py`): the
Authentik OIDC flow's own file, `app/services/oauth_service.py`
(`AuthentikOAuthService`), and the MCP OAuth 2.1 server's own files,
`app/api/public/mcp_oauth.py` / `app/api/v1/endpoints/mcp_oauth_admin.py` /
`app/core/background_claim.py`'s sibling. Each was spot-checked only for
whether it honors the contract this feature's settings advertise — see "New
code reviewed fresh" below for what was actually checked and why each is not
a finding here.

## Re-verification of prior findings

All 30 historical findings across CI-33/CI2-33/CI3-33/CI4-33 that CI5-33
re-verified correct are unaffected by this window's diff (none of their
documented locations fall inside the lines that changed, confirmed above).
The two items CI5-33 left open are re-checked fresh against current code:

| id                                                                                                                    | pass 5 disposition | this pass                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| --------------------------------------------------------------------------------------------------------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CI3-33-3 (HIGH — `REGISTRATION_REQUIRES_APPROVAL` has no reader; every self-registered account is immediately active) | still open         | **✅ now FIXED.** `REGISTRATION_REQUIRES_APPROVAL` no longer exists as a `Settings` field — it is a key in `RETIRED_SETTINGS` (`config.py:81-90`), popped from the raw env dict by `_drop_retired_settings` with a one-line logged warning if a `.env` still names it. The misleading doc comment and the inaccurate `POST /auth/register` docstring are both gone (`grep -n "REGISTRATION_REQUIRES_APPROVAL\|admin approval" app/api/v1/endpoints/auth.py app/services/auth_service.py` — 0 hits). `REGISTRATION_ENABLED` (still `False` by default) is now the only control, and its own comment says so. `tests/test_config_retired_settings.py` (part of the 63 tests run below) covers the pop-and-warn behavior directly. No corresponding row exists in `KNOWN_LIMITATIONS.md` to update — the LOW row (below) already only cross-references this item in passing, for contrast, and carries no stale claim. |
| CI3-33-4 (LOW — `RATE_LIMIT_PER_MINUTE`, `MAX_FILE_SIZE`, `STORAGE_TYPE`, `DB_POOL_MIN` have no reader)               | still open         | **Still open, unchanged.** Fresh grep of `app/`, `scripts/`, `alembic/` for each of the four names, outside `config.py`'s own declaration: 0 hits for all four. `KNOWN_LIMITATIONS.md`'s row (Authentication & Security table, "Several `config.py` settings have no reader anywhere in the backend") is current — it was already updated 2026-10-08 to also cover `UPLOAD_DIR` (independently re-confirmed here, 0 readers), so no edit is needed this pass.                                                                                                                                                                                                                                                                                                                                                                                                                                                       |

## New code reviewed fresh

**`IPBlockingMiddleware` now honors an approved IP allowlist exception
(INT2-28) — correct, and does not reopen the cross-tenant bypass PR #1544
closed.** `_has_ip_exception()` calls
`ip_security_service.ip_has_active_allowlist_exception(db, client_ip)`
(`app/services/ip_security_service.py:502-525`), which is keyed on the exact
IP address alone — no organization filter, by design, because this layer runs
pre-auth with no tenant context (the same reasoning `is_ip_blocked(client_ip,
set())`'s hardcoded empty set already encodes, unchanged). The docstring on
both sides names the tradeoff explicitly: an exception approved by one
organization lets that address past the shared country block for every
organization's traffic, not only the approving one. That is the owner's
accepted cost for a control that cannot know the caller's tenant yet, not an
oversight — and it is a _narrower_ reach than the pre-#1544 bug, which unioned
every organization's exceptions into one set rather than checking the single
requesting address. The lookup fails closed (`except Exception` logs and
returns `False`, leaving the request blocked) and is cached in a bounded,
TTL'd `OrderedDict` (`_ExceptionCache`, `MAX_ENTRIES = 10_000`, 60s TTL,
evicted FIFO via `popitem(last=False)`) — Pitfall #9-compliant, and the cache
is populated only for addresses the country check would already block, so it
cannot be grown by ordinary traffic. `tests/test_ip_allowlist_middleware.py`
(part of the scoped run below) covers this.

**The templated-export-route gap is closed.** `SecurityMonitoringMiddleware`'s
`EXPORT_ENDPOINTS` is an exact-match set, which structurally cannot cover
`GET /api/v1/training/programs/programs/{program_id}/export` — CI4-33 and
CI5-33 both noted this as a known, accepted gap. `_route_template_pattern()`
compiles each `{param}` to a single-path-segment regex
(`re.split(r"\{[^/{}]+\}", template)` joined with `[^/]+`, matched with
`fullmatch`), and `EXPORT_ENDPOINT_TEMPLATES` lists the one real template
route. Verified the registered path matches exactly:
`app/api/v1/api.py:211` mounts `training_programs.router` at prefix
`/training/programs`, and the route itself
(`app/api/v1/endpoints/training_programs.py:2095`,
`@router.get("/programs/{program_id}/export")`) resolves to
`/api/v1/training/programs/programs/{program_id}/export` — byte-for-byte the
one entry in `EXPORT_ENDPOINT_TEMPLATES`. `is_export_endpoint()` checks both
the exact set and the compiled templates. No finding.

**The export-monitoring rewrite is a correctness fix with one incidental
security improvement, not a weakening.** The old code read a
`content-length` response header to size the "how much data left" signal for
`detect_data_exfiltration` — which a `StreamingResponse` (several of the
export routes) never sets, so those exports were invisible to the exfiltration
check despite being in `EXPORT_ENDPOINTS`. The new code sums the length of
every `http.response.body` ASGI message as it streams through
`send_with_monitoring`, which works for both buffered and streamed responses
and does not buffer the body itself (a running integer, not an accumulated
bytearray). The gating condition also tightened from "path is a known export
route and a user is attached" to additionally requiring
`200 <= response_status < 300` — a failed/refused export (403, 500) no longer
generates a size-based exfiltration signal, which is correct: there is no
exported data to measure. The new per-export audit row
(`AUDIT_EVENT_DATA_EXPORT`, confirmed declared at `app/core/constants.py:306`)
carries only `{"endpoint", "method", "bytes"}` plus the standard
`user_id`/`ip_address` — no query string (which can carry a search term
naming a member, per its own comment) and never response content. Checked
`log_audit_event`'s call signature (`app/core/audit.py:1003-1021`) against the
call site — matches. Checked that `organization_id` is populated despite not
being passed explicitly: `create_log_entry` derives it from `user_id` when
omitted (`app/core/audit.py:323-331`), and this call site always has a
non-null `user_id` (gated by the `if user_id and ...` condition), so the row
is never orphaned to a null-org bucket. Its one consumer,
`GET /security/download-activity` (`app/api/v1/endpoints/security_monitoring.py:251-290`,
outside this feature's declared scope but checked as the mechanism that makes
the above claim verifiable) is both permission-gated
(`require_permission("audit.view")`) and explicitly filters
`AuditLog.organization_id == str(current_user.organization_id)` — so the
cross-org IP-allowlist decision above and this audit trail are independent:
one is deliberately tenant-blind by design, the other is correctly
tenant-scoped by construction. No finding.

**The `RETIRED_SETTINGS` mechanism is a sound way to decommission a dead
setting without breaking an existing `.env`.** `_drop_retired_settings`
(`model_validator(mode="before")`) pops a retired key from the raw input dict
before Pydantic ever sees it (so it cannot resurrect a removed field or raise
an "extra field" error) and logs a one-line warning naming the setting and why
it no longer does anything. This is the right shape for exactly the problem
CI3-33-3 identified: a misleading setting is better deleted than left
undocumented-but-present, and this mechanism makes that deletion
non-breaking for every existing deployment's `.env`. `REFRESH_ROTATION_GRACE_SECONDS`
riding along in the same dict (from an unrelated, already-removed refresh-grace
feature per its own comment) was independently confirmed to have no remaining
reader either. No finding.

**`_empty_optional_string_means_unset` is scoped tightly enough to not mask a
real value.** Only fields typed exactly `str | None` with a `None` default are
touched, and only an exact `""` is remapped to `None` — a field with any other
type shape, or any non-empty string, is untouched. This exists because Compose
passes every setting through as `${NAME:-}` (a mapping-form `environment:`
block cannot omit a key), so an operator who leaves an optional integration
setting alone hands the app `""` rather than nothing — and code that checks
`is None` before using a value (several of the new Authentik/MCP-OAuth
settings do exactly this) would otherwise treat a blank, unconfigured value as
configured. `tests/test_compose_settings_passthrough.py` (part of the scoped
run below) holds the round trip for a real value. No finding — this is the
form-value `""`-vs-`None` correctness CLAUDE.md's Pitfall #1 describes,
applied at config-load time rather than a request body, and it goes the
_correct_ direction (empty → unset, not the reverse).

**New Authentik OIDC and MCP OAuth settings both have real readers and fail
closed, spot-checked as new consumers rather than fully reviewed (out of this
feature's declared file scope):** `AUTHENTIK_*` is read by
`AuthentikOAuthService` (`app/services/oauth_service.py`), which restricts
token verification to asymmetric algorithms only
(`_AUTHENTIK_ALGORITHMS = ["RS256","RS384","RS512","ES256","ES384","ES512"]`,
explicitly excluding HS256 — the comment states why: an HS256-signed token is
signed with the client secret, which the comment correctly identifies as
forgeable by anyone holding it), validates the discovery document's declared
endpoints are on the issuer's own origin before trusting them
(`_same_origin`), and checks the document's own `issuer` claim matches the
configured one. `MCP_OAUTH_*` is read by `app/api/public/mcp_oauth.py` /
`mcp_oauth_admin.py`; `Settings.mcp_oauth_origin()` is the single source of
truth for whether the feature is on, rejecting a path/query/fragment/
credentials-bearing issuer URL and requiring `https://` except for loopback —
and every public MCP OAuth route calls `_origin_or_404()`, which answers 404
when `mcp_oauth_origin()` returns `None`, confirmed by reading the route file
directly (`app/api/public/mcp_oauth.py:71-74` and its four call sites). Neither
setting block is itself a finding; recorded at this length because a new
federated-identity provider and a new OAuth authorization server are exactly
the shape of change this feature's checklist (§1, §2) exists to catch, and
"verified good" needs the mechanism stated.

## Verified good ✅ (re-confirmed, no regression)

- **All 30 historical findings across CI-33/CI2-33/CI3-33/CI4-33 hold**, and
  CI3-33-3 specifically has moved from open to fixed (see table above).
- **`database.py` is byte-identical to pass 5** — confirmed by direct
  `git diff --stat`, not inferred from the (misleading, see Scope) commit-log
  path search.
- **CI2-33-1's fix (reading `request.state.authenticated_user` only after
  `await self.app(...)` returns) is intact and is what the new export-audit
  code sits downstream of.** Mechanism: `user_id` is still assigned at
  `security_middleware.py:1796`, inside the `if hasattr(request.state,
"authenticated_user")` block that only runs after the inner `self.app` call —
  re-read directly, not assumed from the diff.
- **`main.py`'s middleware stack, registration order, and both
  production/staging boot-blocking checks are unchanged.** Mechanism: fresh
  grep for `add_middleware`/`validate_security_configuration`/the `SECRET_KEY`
  check, same call sites as every prior pass.
- **`BaseHTTPMiddleware` has zero real usages** in the three in-scope files.
  Mechanism: `grep -rn "BaseHTTPMiddleware"` — only documenting comments.
- **No new unbounded in-memory tracker.** `_ExceptionCache` is the only new
  tracker-shaped object introduced this window, and it is bounded (10,000
  entries, 60s TTL, FIFO eviction) — reviewed above.
- **The IP-allowlist-exception addition does not reintroduce the PR #1544
  cross-tenant bypass**, and the new export-audit trail is correctly
  org-scoped on its read side — both reviewed above with the mechanism
  stated.

## Findings

None new this pass. CI3-33-3 (HIGH, previously flagged) is re-verified fixed
by code already on `main`; CI3-33-4 (LOW, previously flagged) remains open,
unchanged, and its `KNOWN_LIMITATIONS.md` row is current.

## Schema & migration notes

n/a — no schema-touching change in this feature's scope this pass. Alembic
chain re-validated: 566 revisions, single head `dcb8a46ac50c`, no duplicate
ids (`validate_migrations.py --strict`).

## Guard tests added

None by this pass. Every mechanism reviewed above already has a standing test
from the commit that introduced it (`test_ip_allowlist_middleware.py`,
`test_security_alert_workflow.py`, `test_security_middleware.py`,
`test_config_retired_settings.py`, `test_compose_settings_passthrough.py`),
confirmed passing below — this pass found nothing new to close a class on.

## Completion gate

| Check                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Result                                                                                                                                              |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `flake8 app/ tests/ alembic/` (7.3.0, CI's pin)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | ✅ 0 violations                                                                                                                                     |
| `black --check app/ tests/ alembic/` (26.5.1)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | ✅ clean, 2,139 files unchanged                                                                                                                     |
| `isort --check-only app/ tests/ alembic/` (9.0.1, CI's pin)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | ✅ clean                                                                                                                                            |
| `python3 scripts/validate_migrations.py --strict`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | ✅ 566 revisions, single head `dcb8a46ac50c`                                                                                                        |
| Feature-scoped tests (`test_security_middleware.py`, `test_core_infra_boot_checks.py`, `test_database_manager.py`, `test_database_url_encoding.py`, `test_onboarding_rate_limit_scopes.py`, `test_startup_diagnostics.py`, `test_tls_required_config.py`, `test_openapi_contract.py`, `test_email_link_domain.py`, `test_install_sh_frontend_url.py`, `test_installer_frontend_url.py`, `test_unlogged_paths.py`, `test_nginx_config_consistency.py`, `test_config_retired_settings.py`, `test_compose_settings_passthrough.py`, `test_ip_allowlist_middleware.py`, `test_security_alert_workflow.py`) | ✅ 694 passed                                                                                                                                       |
| Cross-cutting guard tests (`test_like_escaping.py`, `test_csv_writer_sweep.py`, `test_database_schema.py::test_set_null_fks_are_nullable`, `test_org_scoping_ratchet.py`, `test_capacity_locking.py`, `test_endpoint_auth_coverage.py`, `test_api_cache_pii_exclusions.py`, `test_migration_create_all_tables.py`, `test_baseline_member_grants.py`)                                                                                                                                                                                                                                                   | ✅ 159 passed                                                                                                                                       |
| Full backend unit suite (`pytest tests/ -m "not integration and not slow and not docker"`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | ✅ **14,092 passed, 1 skipped**, 4,569 deselected (the 1 skip is `test_push_service.py`'s optional `py_vapid`/`pywebpush` dependency, pre-existing) |
| `cd frontend && npm run typecheck` (aliased TS 7.0.2, the actual build compiler)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | ✅ 0 errors                                                                                                                                         |
| `cd frontend && npm run lint` (eslint, max-warnings 10)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | ✅ 0 errors, 0 warnings                                                                                                                             |

**Environment note:** this iteration's sandbox exposes two Python 3
interpreters — `/usr/local/bin/python3` (3.11, no backend dependencies
installed) and `/usr/bin/python3` (3.13, matching CLAUDE.md's declared
backend runtime, with the full dependency set). All backend commands above
ran under the latter. `flake8`/`black`/`isort` were re-pinned to CI's exact
versions (`pip install 'flake8==7.3.0' 'black==26.5.1' 'isort==9.0.1'
'flake8-pytest-style==2.2.0'`) before running, per this skill's own warning
that an unpinned `isort` is the one most likely to diverge silently. MariaDB
and Redis were already running in this sandbox (per `.claude/hooks/session-start.sh`);
no fresh `npm ci` was needed — `frontend/node_modules` was already populated.
