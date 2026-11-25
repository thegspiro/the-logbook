# Security Review — Feature 33: Core Infrastructure (pass 16)

**Prefix:** `CI16` · **Iteration:** 33 · **Reviewed:** 2026-11-25 · **PR:** (recorded after open)

**0 fixed this pass, 0 new findings.** Two real, already-merged deltas since
pass 15's merge, both additions to the export-monitoring registry, traced to
two real new export routes landed by other features, and both independently
verified correct. No other change in any of the three declared scope files.

**Backend:** `app/core/security_middleware.py` (1983 lines, read in full —
+2/-0 since pass 15), `app/core/config.py` (byte-identical to pass 15),
`app/core/database.py` (byte-identical to pass 15).
**Frontend:** none — no frontend file in this feature's scope changed.
**Migrations:** none added by this feature's scope files.

## Step 0 — collision check and freshness

A fresh `list_pull_requests` (state `open`) returned 0 results. `main`'s HEAD
at the start of this iteration was `8b8febfbf` (merge of PR #4709, Feature 32
/ Locations & kiosk, pass 15). `docs/security-review/PROGRESS.md`'s rotation
table showed row 32 ✅ and row 33 (Core infrastructure) as the next `⬜` row —
re-confirmed directly from the table (not from a cached note), the same
discipline CI15 used. Row 33 marked 🔄 before any code was read.

---

## Scope

Pass 15's merge is `c01ab8df1` (PR #4580, `docs/security-review/CI15-33-core-infra.md`).
A path-scoped diff against this feature's three declared scope files, run
fresh against a freshly fetched `origin/main` (604 commits since pass 15):

```
git diff c01ab8df1..origin/main --stat -- \
  backend/app/core/security_middleware.py backend/app/core/database.py \
  backend/app/core/config.py
```

— `database.py` and `config.py` are byte-identical to pass 15's merge (`git
diff` over both files, 0 lines). `security_middleware.py` carries exactly two
real changes, both lines added to the `SecurityMonitoringMiddleware`
export-monitoring registry:

```diff
     EXPORT_ENDPOINTS = {
         ...
+        "/api/v1/users/leave-requests/export",
         "/api/v1/users/me/data-export",
     }
     EXPORT_ENDPOINT_TEMPLATES = (
         "/api/v1/finance/export/logs/{log_id}/imported",
+        "/api/v1/history/articles/{article_id}/export",
         "/api/v1/training/programs/programs/{program_id}/export",
     )
```

Everything else in the 1983-line file, read in full, is unchanged from pass 15.

### The two new registry entries, traced to their real routes

Neither change originated in this feature's own work — both are the
export-monitoring registry catching up with two routes that other features
landed since pass 15, in the same shape pass 14 and pass 15 each found once.
One of the two (`leave-requests/export`) was in fact caught and fixed by this
repository's own CI the same day it landed, before this review pass ever ran
— `commit 4a449056d`, "security: monitor the leave export like every other
export", whose message states directly: _"Backend Unit Tests failed on
4caeeaa7: `test_every_non_parameterized_export_route_is_covered` found
`/api/v1/users/leave-requests/export` missing from
`SecurityMonitoringMiddleware.EXPORT_ENDPOINTS`, so data-exfiltration
monitoring would never have run for it. Registered it."_ The other
(`history/articles/{article_id}/export`) was registered in the same commit
that added the route itself (`2c5f40f72`, "History phase 6 backend: articles,
with PDF and Word export"), again because the same coverage test would have
failed otherwise.

This pass re-verified both routes independently rather than trusting that the
registry addition implies the underlying route is itself sound — that
question is this feature's actual stake (does the cross-cutting monitor see
every export; is the thing it now sees itself safe), even though the routes
belong to other rotation slots (Feature 07 / Users & organizations for leave
requests; a yet-unclaimed "History" module, flagged in `PROGRESS.md` as
needing a rotation-row decision, for the history article export) and are not
otherwise re-reviewed here:

- **`GET /api/v1/users/leave-requests/export`** —
  `backend/app/api/v1/endpoints/leave_requests.py:342-380`, gated by
  `require_permission("members.manage")`. Both the start/end date range and
  the org id resolve server-side: `LeaveCalendarService(db).export_csv(
_org(current_user), start, end)` — every query inside `export_csv`
  (`backend/app/services/leave_calendar_service.py:199+`) is built from that
  single org id, closing XC-3. The CSV itself is written with `SafeCsvWriter`
  (`leave_calendar_service.py:277-278`, confirmed by reading the method, not
  assumed from the module docstring's claim at the top of the file) — closing
  Pitfall #15/CHECKLIST §4. The export is bounded: `export_csv` raises
  `ValueError` (→ 400) when the requested range exceeds `MAX_EXPORT_DAYS`,
  closing CHECKLIST §6's "exports are bounded" item. The route logs
  `leave_records_exported` via `log_audit_event` after a successful read, with
  the date range and row count only — no leave reason, matching the route's
  own docstring ("No reasons. The export is audited.").
- **`GET /api/v1/history/articles/{article_id}/export`** —
  `backend/app/api/v1/endpoints/history_articles.py:363-413`, requires
  `get_current_user` (signed-in only) plus an in-handler read-permission
  check: `service.get_readable_article(viewer, article_id)` resolves the
  article through `get_article(viewer.organization_id, article_id)` — which
  filters `HistoryArticle.organization_id == str(organization_id)` at the
  query itself (`history_article_service.py:172-182`), closing XC-3 — and
  then gates on `can_read(viewer, item)` (`can_read_record(viewer.can_view_archive,
item)`), so a signed-in member of a _different_ organization gets a 404
  from the org filter before the permission check is even reached, and a
  signed-in member of the _same_ org without archive-read standing gets the
  same 404 from the permission check. The rendered PDF/Word content is built
  from `service.export_view(viewer, item)`, which the module's own docstring
  (line 17-ish, "Every query filters `organization_id`; every client-sent id
  is resolved...") states filters to only what that viewer may see — not
  independently re-derived here since `history_articles.py`/
  `history_article_service.py` sit outside this feature's declared scope, but
  the org-scoping and permission gate on the export route itself were read in
  full. The export is audited (`history_article_exported`, with the article id
  and format only) after the file is fully rendered, so a rendering failure
  never emits a partial, un-audited file (`handle_service_errors` wraps the
  render, matching Pitfall #37's "verify, don't assume" and CHECKLIST §4's
  upload/export integrity concern, applied here to the export side).

Both are `GET` methods on paths containing `export`, exactly the shape
`SecurityMonitoringMiddleware.is_export_endpoint()` matches on; registering
them is the correct fix for a real (if short-lived — same-day in one case)
gap in data-exfiltration monitoring coverage, not a feature of this file's
own invention.

### Re-enumeration of the export registry (both directions)

Per the skill's "a repeat pass re-enumerates too" rule, the registry was
checked against the real route table twice: by the existing schema-pinned
test, and independently by hand.

```
backend/tests/test_security_middleware.py::TestExportEndpointsCoverage::test_every_non_parameterized_export_route_is_covered
backend/tests/test_security_middleware.py::TestExportEndpointsCoverage::test_every_parameterized_export_route_is_matched
backend/tests/test_security_middleware.py::TestExportEndpointsCoverage::test_no_stale_entries_for_routes_that_no_longer_exist
```

All three passed (3 passed, 109 deselected — see Completion gate). By hand:
every `@router.get`/`@router.post` decorator across
`backend/app/api/v1/endpoints/` whose literal path contains `export` was
grepped and reconciled against its module's router prefix — 26 flat routes
plus the 3 parameterized templates, all present in `EXPORT_ENDPOINTS` /
`EXPORT_ENDPOINT_TEMPLATES` with the expected prefix. No route found by the
hand grep was absent from the registry, and no registry entry named a route
the hand grep could not account for (the two `@router.put` finance entries
pass 15 already explained — `is_export_endpoint()` matches on path only, not
method, so a `PUT` route with "export" in its path is correctly covered even
though a `get|post`-only grep does not surface it as a decorator to check
against).

## Verified good ✅

- **The export monitoring registry is exhaustive in both directions, machine-checked** —
  `test_every_non_parameterized_export_route_is_covered` and
  `test_every_parameterized_export_route_is_matched`
  (`test_security_middleware.py`) walk the real OpenAPI schema and fail on a
  route the registry misses or a stale entry naming a route that no longer
  exists. Both green; independently re-confirmed by hand above.
- **The two new entries correspond to real, already-gated, already-audited,
  already-bounded endpoints** — `leave_requests.py:342` and
  `history_articles.py:363`, traced in full above: org scoping (XC-3) closed
  at the query/service layer for both, `SafeCsvWriter` used for the CSV
  export, an explicit audit call on both export paths after a successful
  read/render, and a bounded date range on the CSV export.
- **Pure ASGI confirmed repo-wide** (Pitfall #4) — `grep -rn
"BaseHTTPMiddleware" backend/app/` (excluding `__pycache__`) finds only the
  module-level disclaiming comments in `security_middleware.py` and
  `app/mcp/transport.py`; no import anywhere. All five middleware classes
  (`RequestSizeLimitMiddleware`, `SecurityHeadersMiddleware`,
  `IPBlockingMiddleware`, `IPLoggingMiddleware`, `SecurityMonitoringMiddleware`)
  still implement `async def __call__(self, scope, receive, send)`.
- **`RateLimiter`'s in-memory fallback stays bounded under Pitfall #9** —
  unchanged from pass 15: `_MAX_KEYS = 10_000`, `_MAX_LOCKOUTS = 10_000`,
  `_MAX_SATURATION_SCOPES = 1_000`, enforced in `_sweep()`/at insertion
  (confirmed by `grep` locating the same three constants at the same
  enforcement sites, not merely assumed unchanged from the byte-diff).
- **`database.py`'s credential handling is unchanged and still correct** —
  byte-identical to pass 15: percent-encoded DSN construction, `DB_PASSWORD`
  scrubbed from exception messages before logging, re-raised `from None`.
- **`get_client_ip()` is still not spoofable** — `TRUSTED_PROXY_IPS` empty by
  default, forwarded headers trusted only from a configured peer, byte-identical
  to pass 15.
- **The Alembic chain for this feature's own tracked files**: none of the
  three scope files define or touch an ORM model or migration — CHECKLIST §7
  is **n/a** for this feature's scope files this pass, as in every prior pass.
- **The whole-repo migration chain has a single head** —
  `python3 scripts/validate_migrations.py --strict`: 844 revisions, head
  `e9cf8ab7e4e4`. No fork. Not this feature's doing, but re-confirmed rather
  than assumed.

## Re-verification of prior findings

Every item CI15 carried forward is re-checked below by name, per the "report
current status rather than silently dropping it" instruction. None has
changed disposition.

- **Redis/DB TLS `CERT_NONE` without a configured CA, and the cache's lack of
  tenant namespacing** (`cache.py`) — unchanged; `cache.py` has zero diff
  since pass 13 (and since pass 15). Remains **owner-accepted** per the
  2026-10-05 `KNOWN_LIMITATIONS.md` entry ("Core infra: fail-open TLS/image
  handling + latent cache isolation gaps" — items (3) and (4) explicitly
  accepted as-is). No re-flag.
- **`optimize_image` fail-open on a decompression bomb / processing error**
  — unrelated file, outside this feature's three declared scope files;
  tracked by the same KNOWN_LIMITATIONS entry as a flagged, not fixed, item
  (image handling was separately resolved per that entry's item (2); the
  fail-open framing in the entry's own prose is now stale relative to its own
  "Resolved" marker — noted here only so a future reader is not confused by
  the entry's internal inconsistency, not re-opened as a new finding of this
  pass since it is not in this feature's scope files).
- **WebSocket `accept()` precedes auth** (`websocket_manager.py`) — outside
  this feature's current declared scope (adjacent file, not one of the three
  named in `PROGRESS.md` row 33); zero diff since pass 15 (`git diff
c01ab8df1..HEAD -- backend/app/core/websocket_manager.py`, 0 lines). Not
  re-reviewed in depth, consistent with every prior pass's scope-boundary
  note.
- **MFA recovery codes are 40-bit, unsalted SHA-256** (`docs/module-audit/core-infra.md`
  CI-10) — outside this feature's three declared scope files (lives in
  `core/security.py` / MFA service code); well-mitigated per that audit
  (Fernet-encrypted at rest, single-use, lockout-throttled) and
  migration-shaped. Not re-flagged as a new finding of this pass; left as the
  design-track item the audit already tracks.
- **S3/MinIO endpoint allowlist, operator-only** (closed CI13) — unchanged.
  No re-flag.
- **Sign-in limits counted per account at an address** (closed CI13) —
  unchanged; `rate_limit_login()`'s shape is byte-identical. No re-flag.
- **Migration-chain fork (CI14, flagged, resolved at CI15)** — remains
  resolved; single head re-confirmed above with a fresh revision count
  (844, up from 820 at pass 15 — purely additive growth, no new fork).

No historical finding's disposition changed this pass.

## Encountered, not fixed

None this pass.

## Findings

None new this pass. The two real deltas (new entries in
`SecurityMonitoringMiddleware.EXPORT_ENDPOINTS` / `EXPORT_ENDPOINT_TEMPLATES`)
are already-merged, verified-correct fixes for a real (same-day, in one case)
gap in data-exfiltration monitoring coverage, landed by the features that own
the two new routes rather than by this one, and already caught by this
repository's own schema-pinned coverage test before this review pass ran.

## Schema & migration notes

No schema change in any of this feature's tracked files. The whole-repo
migration chain has a single head (844 revisions, `e9cf8ab7e4e4`) — not this
feature's doing, but relevant context for CHECKLIST §7.

## Guard tests added

None — the invariant this pass's delta depends on
(`test_every_non_parameterized_export_route_is_covered` /
`test_every_parameterized_export_route_is_matched`) already existed before
this pass and is what let both new entries be caught and verified
mechanically (one of them automatically, by CI, same day its gap landed)
rather than only by hand.

## Completion gate

| Check                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Result                                                     |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `flake8 app/ tests/ alembic/` (`/usr/bin/python3`, 3.13.18)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | ✅ 0 violations                                            |
| `black --check app/ tests/ alembic/`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | ✅ clean, 3541 files unchanged                             |
| `isort --check-only app/ tests/ alembic/`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | ✅ clean                                                   |
| `python3 scripts/validate_migrations.py --strict`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | ✅ 844 revisions, single head `e9cf8ab7e4e4`               |
| `python3 scripts/check_route_permissions.py --strict` (repo root)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | ✅ 344 routes checked, 0 errors, 0 warnings                |
| Feature-scoped tests (`test_security_middleware.py`, `test_core_infra_boot_checks.py`, `test_database_manager.py`, `test_database_url_encoding.py`, `test_tls_setup.py`, `test_session_limits.py`, `test_mfa_policy.py`, `test_s3_storage.py`, `test_s3_endpoint_allowlist.py`, `test_openapi_contract.py`, `test_config_retired_settings.py`, `test_compose_settings_passthrough.py`, `test_startup_diagnostics.py`, `test_passkeys.py`, `test_rotate_email_fingerprints.py`, `test_email_fingerprint.py`, `test_encrypt_email_migration.py`, `test_encryption_registry_coverage.py`, `test_login_rate_limit_per_account.py`, `test_stepup_throttle.py`) | ✅ 681 passed, 1 pre-existing skip ("root reads any file") |
| Cross-cutting guard tests (`test_like_escaping.py`, `test_csv_writer_sweep.py`, `test_database_schema.py`, `test_org_scoping_ratchet.py`, `test_capacity_locking.py`, `test_endpoint_auth_coverage.py`, `test_api_cache_pii_exclusions.py`, `test_migration_create_all_tables.py`, `test_baseline_member_grants.py`, `test_alembic_migrations.py`, `test_account_status_gates.py`)                                                                                                                                                                                                                                                                        | ✅ 255 passed                                              |
| `cd frontend && npm run typecheck`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | ✅ clean (n/a to this feature — no frontend scope change)  |
| `cd frontend && npm run lint`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | ✅ clean (n/a to this feature — no frontend scope change)  |

**Gate disposition**: every check is clean. No red row to escalate.

**Environment note**, re-confirmed same as CI9/CI11–CI15: `/usr/bin/python3`
(3.13.18, matching `requirements.txt`'s pins) is the interpreter with
`flake8`/`black`/`isort` installed at CI's pinned versions; used explicitly for
every invocation.
