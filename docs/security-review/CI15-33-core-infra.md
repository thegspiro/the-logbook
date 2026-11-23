# Security Review — Feature 33: Core Infrastructure (pass 15)

**Prefix:** `CI15` · **Iteration:** 33 · **Reviewed:** 2026-11-22 · **PR:** (recorded after open)

**0 fixed this pass, 0 new findings.** One real, already-merged delta since
pass 14's merge, diffed, traced to two real new endpoints elsewhere in the
tree, and verified correct. The migration-chain fork pass 14 flagged and left
to PR #4255 is now resolved (single head) — re-confirmed below, not re-flagged.

**Backend:** `app/core/security_middleware.py` (1983 lines, read in full —
+2/-0 since pass 14), `app/core/config.py` (byte-identical to pass 14),
`app/core/database.py` (byte-identical to pass 14).
**Frontend:** none — no frontend file in this feature's scope changed.
**Migrations:** none added by this feature's scope files.

A fresh `list_pull_requests` (state `open`, 18 results) found no
`claude/security-review-*` head. PR #4576 (Feature 32, Locations & kiosk,
pass 14) had already merged (`8c20bff8c`, squash) before this iteration
started; row 32 confirmed ✅ on a freshly-fetched `main`, and row 33 (Core
infrastructure) confirmed as the next pending (`⬜`) row per
`docs/security-review/PROGRESS.md`.

---

## Scope

Pass 14's merge is `027a1e14f` (PR #4266, `docs/security-review/CI14-33-core-infra.md`).
A path-scoped diff against this feature's three declared scope files:

```
git diff 027a1e14f..origin/main --stat -- \
  backend/app/core/security_middleware.py backend/app/core/database.py \
  backend/app/core/config.py
```

— `database.py` and `config.py` are byte-identical to pass 14's merge.
`security_middleware.py` carries exactly one real change, a 2-line addition to
`SecurityMonitoringMiddleware.EXPORT_ENDPOINTS` (the data-exfiltration
monitoring/audit registry, read in full at lines 1793–1838): `
"/api/v1/evaluations/export"` and `"/api/v1/reports/export"`. Everything else
in the 1983-line file, read in full, is unchanged.

### The two new registry entries, traced to their real routes

Both resolve to routes that did not exist in pass 14's scope and are owned by
other features (Evaluations/Reports, not Core infrastructure) — this
feature's only stake is whether the monitoring registry correctly tracks them,
which is exactly what changed:

- **`GET /api/v1/evaluations/export`** — `backend/app/api/v1/endpoints/evaluations.py:627`,
  gated by `require_permission("evaluations.view_all")`. Calls
  `EvaluationService.period_results_csv`, which resolves the review period
  through an org-scoped lookup (`EvaluationPeriod.id == period_id,
EvaluationPeriod.organization_id == organization_id`, returning `None` → 404
  on a miss, closing XC-3) and reuses `list_evaluations` rather than
  re-deriving the row set (Pitfall #29). The CSV is built with `SafeCsvWriter`
  (Pitfall #15) and the response carries `Cache-Control: no-store`. The export
  is audited (`_audit(..., "evaluation_period_exported", {"period_id":
period_id})`) after a successful read.
- **`POST /api/v1/reports/export`** — `backend/app/api/v1/endpoints/reports.py:184`,
  gated by `require_permission("reports.view")` plus
  `_enforce_report_pii_permission(current_user, report_type)` (a report
  exposing members' personal data needs the permission that guards that data
  at its source, per the handler's own docstring, RPT-3). A client-supplied
  `saved_report_id` is resolved through `_active_saved_report()`
  (`reports.py:99`), which filters `SavedReport.organization_id ==
current_user.organization_id` before trusting its stored `report_type`/
  `filters` — closing XC-1/XC-3 for that id. The report itself is regenerated
  server-side (`ReportsService.generate_report`) rather than printed from rows
  the client already holds, so the file matches what the server would show
  this caller and the audit row records a fact, not a claim (the handler's own
  docstring states this design choice).

Both are `POST`/`GET` methods on paths containing `export`, exactly the shape
`SecurityMonitoringMiddleware.is_export_endpoint()` matches on; adding them to
`EXPORT_ENDPOINTS` is the correct fix for a real gap (an export that existed
but was not yet being audit-logged by this cross-cutting mechanism), not a
feature of this file's own invention — `evaluations.py` and `reports.py`
belong to other rotation slots and are not otherwise re-reviewed here.

### Re-enumeration of the export registry (both directions)

Per the skill's "a repeat pass re-enumerates too" rule, the registry was
checked against the real route table by AST/schema inspection rather than
trusted from the diff:

```
backend/tests/test_security_middleware.py::TestExportEndpointsCoverage::test_every_non_parameterized_export_route_is_covered
backend/tests/test_security_middleware.py::TestExportEndpointsCoverage::test_every_parameterized_export_route_is_matched
backend/tests/test_security_middleware.py::TestExportEndpointsCoverage::test_no_stale_entries_for_routes_that_no_longer_exist
```

(class docstring at `test_security_middleware.py:2762`, which records why
this guard exists: CI4-33 found two `/finance/export/*` routes landed by an
unrelated PR with no reason to know this registry existed, silently
unmonitored, before this schema-pinned check was added). The first test fails
if any real `GET`/`POST` route whose path contains `export` is missing from
`EXPORT_ENDPOINTS` or `EXPORT_ENDPOINT_TEMPLATES`; the second fails if a
template no longer matches a real parameterized route, or over-matches a
longer path it should not; the third fails if an entry names a route that no
longer exists. All three passed (see Completion gate). Independently
cross-checked by hand: every
`@router.get`/`@router.post` decorator across `backend/app/api/v1/endpoints/`
whose literal path contains `export` was enumerated and resolved against its
module's `include_router(prefix=...)` in `api.py` — 29 concrete routes (27
flat + 2 parameterized), all present in the registry; the two registry entries
that did **not** show up in a `get|post`-only grep
(`/finance/export/advance-accounts`, `/finance/export/dues-accounts`) are
`@router.put`, not missing — `is_export_endpoint()` matches on path only, not
method, so this is not a gap.

## Verified good ✅

- **The export monitoring registry is exhaustive in both directions, machine-checked** —
  `test_every_non_parameterized_export_route_is_covered` and
  `test_every_parameterized_export_route_is_matched`
  (`test_security_middleware.py`) walk the real OpenAPI schema and fail on a
  route the registry misses or a stale entry naming a route that no longer
  exists. Both green; independently re-confirmed by hand above.
- **The two new entries correspond to real, already-gated, already-audited
  endpoints** — `evaluations.py:627` and `reports.py:184`, traced above: org
  scoping (XC-3) closed at the service layer for both, a client-supplied FK id
  (`saved_report_id`) validated in-org before being trusted (XC-1), CSV output
  via `SafeCsvWriter`, and an explicit audit call on both export paths.
- **`GET /evaluations/export` is excluded from the frontend's response cache**
  — `UNCACHEABLE_PREFIXES` in `frontend/src/utils/apiCache.ts` carries
  `'/evaluations'` with no trailing slash, documented there (line ~153-158) to
  cover sub-paths including this one. `POST /reports/export` needs no such
  entry: `frontend/src/services/apiClient.ts:84` gates caching on
  `method === 'GET'` before consulting `isCacheable()` at all, so a `POST`
  response is never cached regardless of `UNCACHEABLE_PREFIXES` — confirmed by
  reading the interceptor, not assumed.
- **Pure ASGI confirmed repo-wide** (Pitfall #4) — `grep -rn
"BaseHTTPMiddleware" backend/app/` (excluding `__pycache__`) finds only the
  module-level disclaiming comments in `security_middleware.py` and
  `app/mcp/transport.py`; no import anywhere. All five middleware classes
  still implement `async def __call__(self, scope, receive, send)`.
- **`RateLimiter`'s in-memory fallback stays bounded under Pitfall #9** —
  unchanged from pass 14: `_MAX_KEYS = 10_000`, `_MAX_LOCKOUTS = 10_000`,
  `_MAX_SATURATION_SCOPES = 1_000`, enforced in `_sweep()`/at insertion.
- **`database.py`'s credential handling is unchanged and still correct** —
  byte-identical to pass 14: percent-encoded DSN construction, `DB_PASSWORD`
  scrubbed from exception messages before logging, re-raised `from None`.
- **`get_client_ip()` is still not spoofable** — `TRUSTED_PROXY_IPS` empty by
  default, forwarded headers trusted only from a configured peer, byte-identical
  to pass 14.
- **The Alembic chain for this feature's own tracked files**: none of the
  three scope files define or touch an ORM model or migration — CHECKLIST §7
  is **n/a** for this feature's scope files this pass, as in every prior pass.
- **The whole-repo migration chain now has a single head** —
  `python3 scripts/validate_migrations.py --strict`: 820 revisions, head
  `561a3e9f4165`. Pass 14's flagged fork (`0136dd6d4144`/`7b6db9dd8e4f`,
  tracked by PR #4255) is resolved; `tests/test_alembic_migrations.py`'s two
  previously-failing assertions now pass (see Completion gate). Not this
  feature's fix — a different, already-landed merge revision — but
  re-confirmed rather than assumed, since the prior pass's report named it as
  the one red gate row.

## Re-verification of prior findings

- **Redis/DB TLS `CERT_NONE` without a configured CA, and the cache's lack of
  tenant namespacing** (`cache.py`) — unchanged; `cache.py` has zero diff
  since pass 13. Remains **owner-accepted** per the 2026-10-05
  `KNOWN_LIMITATIONS.md` entry. No re-flag.
- **WebSocket `accept()` precedes auth** (`websocket_manager.py`) — outside
  this feature's current declared scope (adjacent file, not one of the three
  named in `PROGRESS.md` row 33); not re-reviewed in depth, consistent with
  pass 14's scope-boundary note.
- **S3/MinIO endpoint allowlist, operator-only** (closed CI13) — unchanged.
  No re-flag.
- **Sign-in limits counted per account at an address** (closed CI13) —
  unchanged; `rate_limit_login()`'s shape is byte-identical. No re-flag.
- **CI3-33 historical items** — resolved in earlier passes or retired; not
  carried forward.
- **Migration-chain fork (CI14, flagged, tracked by #4255)** — resolved; see
  "Verified good" above. Disposition updated from FLAGGED to **RESOLVED
  (elsewhere)** — not this feature's own fix, but confirmed closed.

No other historical finding's disposition changed this pass.

## Encountered, not fixed

None this pass.

## Findings

None new this pass. The one real delta (two new entries in
`SecurityMonitoringMiddleware.EXPORT_ENDPOINTS`) is an already-merged,
verified-correct fix for a real gap in data-exfiltration monitoring coverage,
landed by the features that own the two new routes rather than by this one.

## Schema & migration notes

No schema change in any of this feature's tracked files. The whole-repo
migration chain, forked as of pass 14, now has a single head (see "Verified
good" above) — not this feature's doing, but relevant context for CHECKLIST §7.

## Guard tests added

None — the invariant this pass's delta depends on
(`test_every_non_parameterized_export_route_is_covered` /
`test_every_parameterized_export_route_is_matched`) already existed before
this pass and is what let the two new entries be verified mechanically rather
than only by hand.

## Completion gate

| Check                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Result                                                                                  |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `flake8 app/ tests/ alembic/` (`/usr/bin/python3`, 3.13.18)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | ✅ 0 violations                                                                         |
| `black --check app/ tests/ alembic/`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | ✅ clean, 3421 files unchanged                                                          |
| `isort --check-only app/ tests/ alembic/`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | ✅ clean                                                                                |
| `python3 scripts/validate_migrations.py --strict`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | ✅ 820 revisions, single head `561a3e9f4165`                                            |
| Feature-scoped tests (`test_security_middleware.py`, `test_core_infra_boot_checks.py`, `test_database_manager.py`, `test_database_url_encoding.py`, `test_tls_setup.py`, `test_session_limits.py`, `test_mfa_policy.py`, `test_s3_storage.py`, `test_s3_endpoint_allowlist.py`, `test_openapi_contract.py`, `test_config_retired_settings.py`, `test_compose_settings_passthrough.py`, `test_startup_diagnostics.py`, `test_passkeys.py`, `test_rotate_email_fingerprints.py`, `test_email_fingerprint.py`, `test_encrypt_email_migration.py`, `test_encryption_registry_coverage.py`, `test_login_rate_limit_per_account.py`, `test_stepup_throttle.py`) | ✅ 681 passed, 1 pre-existing skip ("root reads any file")                              |
| Cross-cutting guard tests (`test_like_escaping.py`, `test_csv_writer_sweep.py`, `test_database_schema.py`, `test_org_scoping_ratchet.py`, `test_capacity_locking.py`, `test_endpoint_auth_coverage.py`, `test_api_cache_pii_exclusions.py`, `test_migration_create_all_tables.py`, `test_baseline_member_grants.py`, `test_alembic_migrations.py`, `test_account_status_gates.py`)                                                                                                                                                                                                                                                                        | ✅ 253 passed — including both previously-failing migration-chain assertions, now green |
| `cd frontend && npm run typecheck`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | n/a (no frontend file in this feature's scope changed)                                  |
| `cd frontend && npm run lint`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | n/a (no frontend file in this feature's scope changed)                                  |

**Gate disposition**: every check is clean. Unlike pass 14, there is no red
row to escalate — the migration fork that pass left open has since been
resolved by an unrelated, already-merged PR.

**Environment note**, re-confirmed same as CI9/CI11–CI14: `/usr/bin/python3`
(3.13.18, matching `requirements.txt`'s pins) is the interpreter with
`flake8`/`black`/`isort` installed at CI's pinned versions; used explicitly for
every invocation.
