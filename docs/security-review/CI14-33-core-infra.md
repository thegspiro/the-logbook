# Security Review — Feature 33: Core Infrastructure (pass 14)

**Prefix:** `CI14` · **Iteration:** 33 · **Reviewed:** 2026-11-11 · **PR:** (recorded after open)

**0 fixed this pass, 0 new findings.** One real, already-merged delta since
pass 13's merge, reviewed and verified correct. One pre-existing, out-of-scope
infrastructure defect encountered and flagged (not fixed here — already being
resolved by a dedicated, unrelated open PR; see "Encountered, not fixed"
below).

**Backend:** `app/core/security_middleware.py`, `app/core/config.py`,
`app/core/database.py` — `security_middleware.py` and `database.py` are
byte-identical to pass 13's merge; `config.py` carries one real,
already-merged delta (below).
**Frontend:** none — no frontend file in this feature's scope changed.
**Migrations:** none added by this feature's scope files.

A fresh `list_pull_requests` (state `open`) found nine open PRs, none with a
`claude/security-review-*` head. PR #4252 (Feature 32, Locations & kiosk,
pass 13) had already merged clean (`b29782324`). Row 33 (Core infrastructure)
confirmed the next pending (`⬜`) row on a freshly-fetched `main`, per
`docs/security-review/PROGRESS.md`.

---

## Scope

Pass 13's merge is `f67f45259` (PR #4017). A path-scoped diff against this
feature's three declared scope files found a real change in one:

```
git diff f67f45259..HEAD --stat -- \
  backend/app/core/security_middleware.py backend/app/core/database.py \
  backend/app/core/config.py
```

— `security_middleware.py` (1982 lines, read in full) and `database.py` (293
lines, read in full) are byte-identical to pass 13's merge. `config.py`
(+29/-0) carries one real, already-merged change, read in context, out of 916
non-merge commits landing on `main` in the 7 days between.

Four adjacent files tracked for continuity by earlier passes
(`security.py`, `encrypted_types.py`, `cache.py`, `websocket_manager.py`) also
changed in this window (`security.py` +22, `encrypted_types.py` +82,
`websocket_manager.py` +1/-1; `cache.py` unchanged). These are **outside this
feature's current declared scope** (PROGRESS.md row 33 names only
`security_middleware.py`, `database.py`, `config.py`) — `security.py`'s delta
(a constant-time dummy Argon2 verification, `burn_password_verification()`,
for sign-in paths that refuse before checking a real password) is Auth &
session lifecycle's (Feature 01) own territory, which is already ✅ in the
rotation. Not reviewed here, consistent with the Feature 28/33 scope-boundary
precedent recorded in this feature's history.

### `config.py` — a QuickBooks Online app connection, operator-configured (+29 lines)

Four new `Settings` fields: `QBO_CLIENT_ID`, `QBO_CLIENT_SECRET`,
`QBO_REDIRECT_URI` (all `str | None = None`), and `QBO_ENVIRONMENT: str =
"sandbox"` with a `@field_validator` rejecting anything other than
`"sandbox"`/`"production"` (case/whitespace-normalized). This is the
credential half of a new Finance feature (QuickBooks Online live posting,
owned by Feature 05) — `config.py`'s only involvement is declaring and
validating these four environment-sourced settings.

## Verified good ✅

- **The new settings are operator-only env vars, not a department-settable
  column** — all four are top-level `Settings` fields read from the process
  environment; `grep -rn "QBO_" backend/app/schemas/organization.py
backend/app/api/v1/endpoints/organizations.py` finds no write path. A
  department administrator cannot set or change them.
- **`QBO_ENVIRONMENT` defaults safely** — `"sandbox"`, not `"production"`, so
  keys pasted in without this var set cannot post into a department's live
  books by accident; the validator rejects any other value at startup rather
  than silently normalizing or ignoring it.
- **`QBO_CLIENT_SECRET` is never echoed** — `grep -rn "QBO_CLIENT_SECRET"
backend/app` shows it is read only by `quickbooks_online_client.py` (to build
  an OAuth token request) and named (never valued) in
  `quickbooks_online.py`'s "not configured" error message and
  `scheduled_tasks.py`'s task description string. Confirmed no call site
  formats the setting's _value_ into a response, log line, or error detail.
- **The hardcoded `__repr__`/`__str__` allowlist (`config.py:1694`) cannot leak
  the new fields** — it enumerates eleven specific attributes by name
  (masking `DB_PASSWORD`, `SECRET_KEY`, `ENCRYPTION_KEY`, `REDIS_PASSWORD`) and
  constructs the string from that fixed list, not from `self.__dict__` or
  `model_dump()`. A field simply not being in the list means it is never
  rendered through this mechanism, by construction — unlike a redact-by-name
  approach, a newly added secret field cannot be missed. `grep -rn
"settings\.model_dump\|settings\.dict\(\|vars(settings)" backend/app` finds
  no call site that dumps the global `Settings` instance wholesale (the
  `model_dump()` hits found are all on per-request Pydantic schema objects
  named `settings_dict`/`email_settings`/etc., organization-settings JSON —
  a different object entirely).
- **Pure ASGI confirmed repo-wide** (Pitfall #4) — `grep -rn
"BaseHTTPMiddleware" backend/app/` (excluding `__pycache__`) finds only the
  module-level comment in `security_middleware.py` disclaiming it and a
  matching comment in `app/mcp/transport.py`; no import anywhere. All five
  middleware classes in this file (`RequestSizeLimitMiddleware`,
  `SecurityHeadersMiddleware`, `IPBlockingMiddleware`, `IPLoggingMiddleware`,
  `SecurityMonitoringMiddleware`) implement `async def __call__(self, scope,
receive, send)`, confirmed by AST-level `grep` of every class/`__call__`
  pair in the file.
- **`RateLimiter`'s in-memory fallback stays bounded under Pitfall #9** —
  unchanged from pass 13: `_MAX_KEYS = 10_000`, `_MAX_LOCKOUTS = 10_000`,
  `_MAX_SATURATION_SCOPES = 1_000`, all enforced in `_sweep()`/at insertion,
  with active lockouts (a security decision already made) protected from
  early eviction and evictable entries sized off their own count rather than
  the combined total — re-read in full, logic unchanged from the byte-for-byte
  file.
- **`database.py`'s credential handling is unchanged and still correct** —
  `_db_credentials` percent-encodes user/password with `safe=''` so a
  reserved character (`@:/?#%`) in a generated password cannot truncate the
  DSN; `DatabaseManager.connect()` scrubs `DB_PASSWORD` (both raw and
  percent-encoded forms) out of any exception message before logging or
  re-raising, and re-raises `from None` so the unscrubbed original exception
  is never chained. Re-read in full; byte-identical to pass 13.
- **`get_client_ip()` is still not spoofable** — `TRUSTED_PROXY_IPS` empty by
  default (secure-by-default), forwarded headers only trusted from a
  configured trusted peer, and the right-most non-trusted-proxy `X-Forwarded-
For` hop is taken (matching how nginx appends), unchanged from pass 13.
- **The Alembic chain for this feature's own tracked files**: neither
  `security_middleware.py` nor `database.py` nor `config.py` define or touch
  any ORM model or migration; the new QBO settings are plain env vars with no
  schema footprint. CHECKLIST §7 (schema & migration integrity) is **n/a** for
  this feature's scope files this pass.

## Re-verification of prior findings

- **Redis/DB TLS `CERT_NONE` without a configured CA, and the cache's lack of
  tenant namespacing** (`cache.py`) — unchanged (zero diff this window);
  remains **owner-accepted** per the 2026-10-05 `KNOWN_LIMITATIONS.md` entry
  ("Core infra: fail-open TLS/image handling + latent cache isolation gaps").
  No re-flag.
- **WebSocket `accept()` precedes auth** (`websocket_manager.py`) — one-line
  diff this window (`+1/-1`), unrelated to the auth-before-accept shape;
  deliberate, per the same entry. Out of this feature's current scope
  (adjacent file, not one of the three named in PROGRESS.md row 33); not
  re-reviewed in depth.
- **S3/MinIO endpoint allowlist, operator-only** (closed CI13) — unchanged;
  `S3_ALLOWED_ENDPOINTS` remains a top-level env setting with no
  department-facing write path. No re-flag.
- **Sign-in limits counted per account at an address** (closed CI13) —
  unchanged; `rate_limit_login()`'s two-check shape (per-address backstop,
  per-account-at-address limit) is byte-identical to pass 13. No re-flag.
- **CI3-33 historical items** (`REGISTRATION_REQUIRES_APPROVAL` retired
  setting, MFA recovery-code hashing) — resolved in earlier passes, out of
  this feature's scope or retired; not carried forward.

No other historical finding's disposition changed this pass.

## Encountered, not fixed

- **Migration chain forked on `main` itself, outside this feature's diff.**
  `validate_migrations.py --strict` and `tests/test_alembic_migrations.py`
  both fail: two unreconciled heads, `0136dd6d4144`
  (`20261111_1320_..._budget_request_drafts_may_be_blank.py`) and
  `7b6db9dd8e4f`
  (`20261111_1321_..._meeting_attendee_waiver_request_link_.py`), both
  descending from `09f0171ccf5e` with no merge revision joining them. Neither
  revision touches this feature's models or tables (`shift_signup_window`,
  budget-request drafts and meeting-attendee waiver links are Finance/Meetings
  territory), and `config.py`/`database.py`/`security_middleware.py` declare
  no models, so this feature's own scope files cannot have caused it and
  fixing it has no overlap with this feature's code.
  **Not fixed here**: a `list_pull_requests` check at review time found PR
  [#4255](https://github.com/thegspiro/the-logbook/pull/4255) ("Migrations:
  join the two heads main gained today (#4250 + #4247)") already open and
  specifically addressing this exact fork. Creating a second, independent
  merge migration in this PR would not help — whichever of the two merges to
  `main` first resolves the fork, and the other would then itself need
  rebasing onto a revision this PR cannot predict; a competing merge revision
  opened from a now-stale base is exactly the kind of duplicate fix CLAUDE.md's
  Pitfall #24 cautions against creating conflicting work. Flagged here per the
  CLAUDE.md "Hard Stop" escalation path rather than attempted, since a correct
  fix is already in flight on a dedicated PR and doing it twice has a real
  chance of making the fork worse, not better.
  **Disposition: FLAGGED (not this feature's defect; tracked by #4255).**

## Findings

None new this pass. The one real delta (QuickBooks Online settings in
`config.py`) is an already-merged, verified-correct addition — an
operator-only credential surface with a safe default and no leak path.

## Schema & migration notes

No schema change in any of this feature's tracked files (`security_middleware.py`,
`database.py`, `config.py` declare no ORM models or migrations). The migration
chain itself is forked on `main` by two unrelated PRs' already-merged
migrations — see "Encountered, not fixed" above; not this feature's doing and
not fixed in this PR.

## Guard tests added

None — no new code in this feature's scope to guard. The QBO settings already
carry their own dedicated test coverage elsewhere in the tree (Finance
feature's test files), re-run clean below as part of this feature's scoped
selection where overlapping.

## Completion gate

| Check                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Result                                                                                                                                                                                                                                                                                                                                                                                          |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `flake8 app/ tests/ alembic/` (via `/usr/bin/python3`, 3.13.18)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | ✅ 0 violations                                                                                                                                                                                                                                                                                                                                                                                 |
| `black --check app/ tests/ alembic/`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | ✅ clean, 3125 files unchanged                                                                                                                                                                                                                                                                                                                                                                  |
| `isort --check-only app/ tests/ alembic/`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | ✅ clean                                                                                                                                                                                                                                                                                                                                                                                        |
| `python3 scripts/validate_migrations.py --strict`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | ❌ 759 revisions, **2 heads** (`0136dd6d4144`, `7b6db9dd8e4f`) — pre-existing fork on `main`, unrelated to this feature's scope files, already tracked by open PR #4255 (see "Encountered, not fixed")                                                                                                                                                                                          |
| Feature-scoped tests (`test_security_middleware.py`, `test_core_infra_boot_checks.py`, `test_database_manager.py`, `test_database_url_encoding.py`, `test_tls_setup.py`, `test_session_limits.py`, `test_mfa_policy.py`, `test_s3_storage.py`, `test_s3_endpoint_allowlist.py`, `test_openapi_contract.py`, `test_config_retired_settings.py`, `test_compose_settings_passthrough.py`, `test_startup_diagnostics.py`, `test_passkeys.py`, `test_rotate_email_fingerprints.py`, `test_email_fingerprint.py`, `test_encrypt_email_migration.py`, `test_encryption_registry_coverage.py`, `test_login_rate_limit_per_account.py`, `test_stepup_throttle.py`) | ✅ 681 passed, 1 pre-existing skip ("root reads any file")                                                                                                                                                                                                                                                                                                                                      |
| Cross-cutting guard tests (`test_like_escaping.py`, `test_csv_writer_sweep.py`, `test_database_schema.py`, `test_org_scoping_ratchet.py`, `test_capacity_locking.py`, `test_endpoint_auth_coverage.py`, `test_api_cache_pii_exclusions.py`, `test_migration_create_all_tables.py`, `test_baseline_member_grants.py`, `test_alembic_migrations.py`, `test_account_status_gates.py`)                                                                                                                                                                                                                                                                        | ❌ 249 passed, **2 failed** (`test_alembic_migrations.py::TestMigrationChain::test_exactly_one_head`, `::TestNoDuplicateRevisions::test_forks_are_resolved_into_a_single_head`) — same pre-existing fork as above; both failures are assertions about the migration DAG's shape, not about this feature's code, and resolve themselves once #4255 (or any correct merge of the two heads) lands |
| `cd frontend && npm run typecheck`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | ✅ clean (no frontend file in this feature's scope changed)                                                                                                                                                                                                                                                                                                                                     |
| `cd frontend && npm run lint`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | ✅ clean (no frontend file in this feature's scope changed)                                                                                                                                                                                                                                                                                                                                     |

**Gate disposition**: every check this feature's own code can affect is clean.
The two migration-chain failures are a real, currently-red state of `main`
caused by two unrelated, already-merged PRs (Finance's budget-request-drafts
migration and Meetings' waiver-request-link migration) landing with
independent heads off the same parent, and are already being resolved by a
dedicated open PR (#4255) that is not part of the security-review rotation.
Per CLAUDE.md's "Hard Stop" escalation path, this is reported in full rather
than fixed with a second, competing merge migration in this PR.

**Environment note**, re-confirmed same as CI9/CI11/CI12/CI13: `/usr/bin/python3`
(3.13.18, matching `requirements.txt`'s pins) is the interpreter with
`flake8`/`black`/`isort` installed at CI's pinned versions; `/usr/local/bin/python3`
resolves a different (3.11) interpreter with nothing installed for this
session. Used `/usr/bin/python3 -m <tool>` explicitly for every invocation and
verified the version before trusting any result.
