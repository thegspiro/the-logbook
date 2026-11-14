# Security Review — Feature 33: Core Infrastructure (pass 13)

**Prefix:** `CI13` · **Iteration:** 33 · **Reviewed:** 2026-11-04 · **PR:** (recorded after open)

**0 fixed this pass, 0 new findings.** Two real, already-merged deltas since
pass 12's merge, both reviewed and verified correct.

**Backend:** `app/core/security_middleware.py`, `app/core/config.py`,
`app/core/database.py` — `database.py` byte-identical to pass 12's merge;
`security_middleware.py` and `config.py` both carry real, already-merged
deltas (below).
**Frontend:** none — no frontend file in this feature's scope changed.
**Migrations:** none.

Watchdog pickup — the dedicated `/loop 30m /security-review` session
(`session_011T1ZyyLrD5HagusgK9uDw2`) remains unreachable (confirmed via
`ListAgents`, "No reachable agents"). PR #4016 (Feature 32, Locations &
kiosk, pass 12) had just merged (`be9ac0f9e`); a GitHub listing of open PRs
returned nothing whose head branch starts with `claude/security-review-`.
Row 33 (Core infrastructure) confirmed the next `⬜` row on a freshly-fetched
`main`.

---

## Scope

Pass 12's merge is `04bd78e6c` (PR #3867). A path-scoped diff against the
same seven files pass 11/12 track found real changes in two:

```
git diff 04bd78e6c..HEAD --stat -- \
  backend/app/core/security_middleware.py backend/app/core/database.py \
  backend/app/core/config.py backend/app/core/security.py \
  backend/app/core/encrypted_types.py backend/app/core/cache.py \
  backend/app/core/websocket_manager.py
```

— `security.py`, `encrypted_types.py`, `cache.py`, `websocket_manager.py` and
`database.py` are byte-identical to pass 12's merge. `config.py` (+90/-0) and
`security_middleware.py` (+88/-10) each carry a real, already-merged change,
both read in full, out of **508** non-merge commits landing on `main` in the
5 days between.

### `config.py` — an operator-only S3/MinIO endpoint allowlist (closes part of SCH-10)

`normalize_endpoint_url()` is new: it rejects anything that is not an
absolute `http(s)` URL with a host, rejects embedded credentials/query/
fragment, and returns a canonical lowercase-scheme-and-host, explicit-port,
no-trailing-slash form. The new `S3_ALLOWED_ENDPOINTS` setting (comma-
separated, validated at startup via `@field_validator`) is this canonical
form's only consumer inside this file; `get_s3_allowed_endpoints()` returns
the parsed, re-validated list. This closes the S3/MinIO half of
`KNOWN_LIMITATIONS.md`'s SCH-10 entry — an operator-set allowlist, not a
department-settable one, matching the 2026-11-03 "its endpoint made
operator-only" update already recorded there.

### `security_middleware.py` — sign-in limits counted per account at an address (closes the Shared Station Address decision)

`check_rate_limit()` gained an optional `account` parameter, appended to the
limiter key after a `#` (neither an IPv4 nor IPv6 address contains one).
`rate_limit_login()` now runs two checks: a looser per-**address** backstop
(30/min, no lockout, unchanged scope `login_address`) and a per-**account-at-
address** limit (5/min, 30-minute lockout, scope `login`) — closing
`KNOWN_LIMITATIONS.md`'s "Sign-in From a Shared Station Address" entry, where
the old per-address-only limit locked out every member behind a station's one
public address once the sixth person mistyped a password.

## Verified good ✅

- **`normalize_endpoint_url`'s comparison is exact, not prefix/substring** —
  its one caller outside this file, `app/services/s3_storage.py:213`
  (`normalize_endpoint_url(entry) == wanted`), uses `==` on the canonical
  form from both sides; confirmed by reading the call site, since a prefix
  match here is exactly the SSRF bypass (`https://minio.example.org.attacker.net`
  riding on a listed `https://minio.example.org`) the function's own
  docstring names.
- **`S3_ALLOWED_ENDPOINTS` names _which_ endpoint, `S3_ALLOW_PRIVATE_ENDPOINT`
  still decides whether a private/plain-HTTP one may be reached** — both
  settings are read independently in `s3_storage.py` (confirmed by `grep`);
  listing an endpoint does not itself bypass the private-network/plain-HTTP
  refusal.
- **The S3 allowlist is operator-only** — `S3_ALLOWED_ENDPOINTS` is a
  top-level `Settings` field (an env var), not an organization-settings
  column; `grep -rn "S3_ALLOWED_ENDPOINTS" backend/app/schemas/organization.py
backend/app/api/v1/endpoints/organizations.py` finds no write path, only a
  read-only surface for display. A department administrator cannot set it,
  matching the owner decision.
- **The login rate-limit key cannot be forged into another account's or
  address's bucket** — `account_key` is either `None` (sent as the literal
  string `"-"`), a SHA-256 hash truncated to 32 hex characters
  (`login_account_key`, no `#` possible in hex), or `f"user:{sub}"` where
  `sub` comes from a signature-verified JWT (`decode_token`), never from
  unauthenticated request data. `client_ip` comes from `get_client_ip()`,
  which only trusts `X-Forwarded-For` from a configured `TRUSTED_PROXY_IPS`
  and otherwise falls back to the socket peer — neither produces a `#`.
- **The limit is counted whether or not the account is real**
  (`_login_attempt_account`'s own docstring and implementation) — an
  attacker cannot use "does this address get rate-limited" as a username-
  enumeration oracle; this is the same anti-enumeration shape
  `check_rate_limit`'s pre-existing scope comment already documents for the
  session-revocation case.
- **A session thief cannot lock the real owner out via step-up** —
  `app/core/stepup_throttle.py` (new in this window, a reader of this
  feature's new `STEPUP_MAX_FAILED_ATTEMPTS`/`STEPUP_FAILURE_WINDOW_MINUTES`
  settings per Pitfall #19) never touches `failed_login_attempts` /
  `locked_until`; confirmed by reading the whole file — it is a separate,
  per-account, Redis-backed (bounded in-memory fallback per Pitfall #9)
  counter with no account-lock path. `POST /auth/step-up` reserves the
  attempt (`reserve_stepup_attempt`) _before_ checking the secret, closing
  the parallel-request race the module's own docstring names, and clears it
  (`clear_stepup_failures`) only after a proven step-up.
- **The in-memory step-up fallback is bounded** (Pitfall #9) —
  `_InMemoryStepUpCounter._MAX_KEYS = 10_000` with periodic eviction of
  expired windows first, then the soonest-to-expire entries if still over
  the cap.
- **The Alembic chain still has a single head** —
  `validate_migrations.py --strict` reports 712 revisions, one head
  (`b5e906ebdd7d`), up from pass 12's 678, no fork.
- **`rate_limit_passkey`'s own call sites are unaffected** — it is a
  different function from `rate_limit_login`; `grep -n "def rate_limit_passkey"
backend/app/core/security_middleware.py` confirms it is untouched by this
  window's diff (outside the hunks shown above).

## Re-verification of prior findings

- **Redis/DB TLS `CERT_NONE` without a configured CA, and the cache's lack
  of tenant namespacing** (`cache.py`) — unchanged (zero diff, confirmed
  above); both remain **owner-accepted** per the 2026-10-05
  `KNOWN_LIMITATIONS.md` entry. No re-flag.
- **WebSocket `accept()` precedes auth** (`websocket_manager.py`) —
  unchanged (zero diff); deliberate, per the same entry. No re-flag.
- **MFA recovery-code hashing** — out of this feature's scope, resolved; not
  carried forward (per CI12's correction).
- **CI3-33-3 (`REGISTRATION_REQUIRES_APPROVAL`)** — resolved, retired
  setting; not carried forward.

No other historical finding's disposition changed this pass.

## Findings

None this pass. Both real deltas are already-merged, verified-correct
security improvements (an allowlist narrowing an existing gap, and a rate
limiter fix closing a false-positive lockout) rather than defects.

## Schema & migration notes

No schema change in any of this feature's tracked files. Alembic chain: 712
revisions, single head `b5e906ebdd7d` (up from pass 12's 678, no fork).

## Guard tests added

None — no new code to guard; both deltas already carry their own dedicated
test files (`test_s3_endpoint_allowlist.py`, `test_login_rate_limit_per_account.py`,
`test_stepup_throttle.py`), all re-run clean below.

## Completion gate

| Check                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Result                                                     |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `flake8 app/ tests/ alembic/` (via `/usr/bin/python3`, 3.13.18)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | ✅ 0 violations                                            |
| `black --check app/ tests/ alembic/`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | ✅ clean, 2881 files unchanged                             |
| `isort --check-only app/ tests/ alembic/`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | ✅ clean                                                   |
| `python3 scripts/validate_migrations.py --strict`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | ✅ 712 revisions, single head `b5e906ebdd7d`               |
| Feature-scoped tests (`test_security_middleware.py`, `test_core_infra_boot_checks.py`, `test_database_manager.py`, `test_database_url_encoding.py`, `test_tls_setup.py`, `test_session_limits.py`, `test_mfa_policy.py`, `test_s3_storage.py`, `test_s3_endpoint_allowlist.py`, `test_openapi_contract.py`, `test_config_retired_settings.py`, `test_compose_settings_passthrough.py`, `test_startup_diagnostics.py`, `test_passkeys.py`, `test_rotate_email_fingerprints.py`, `test_email_fingerprint.py`, `test_encrypt_email_migration.py`, `test_encryption_registry_coverage.py`, `test_login_rate_limit_per_account.py`, `test_stepup_throttle.py`) | ✅ 678 passed, 1 pre-existing skip ("root reads any file") |
| Cross-cutting guard tests (`test_like_escaping.py`, `test_csv_writer_sweep.py`, `test_database_schema.py`, `test_org_scoping_ratchet.py`, `test_capacity_locking.py`, `test_endpoint_auth_coverage.py`, `test_api_cache_pii_exclusions.py`, `test_migration_create_all_tables.py`, `test_baseline_member_grants.py`, `test_alembic_migrations.py`, `test_account_status_gates.py`)                                                                                                                                                                                                                                                                        | ✅ 242 passed                                              |
| `cd frontend && npm run typecheck`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | n/a — no frontend file touched this pass                   |
| `cd frontend && npm run lint`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | n/a — no frontend file touched this pass                   |

**Environment note**, re-confirmed same as CI9/CI11/CI12: `/usr/bin/python3`
(3.13.18, matching `requirements.txt`'s pins) is the interpreter with
`flake8`/`black`/`isort` installed at CI's pinned versions; `/usr/local/bin/python3`
resolves a different (3.11) interpreter with nothing installed for this
session. Used `/usr/bin/python3 -m <tool>` (aliased here as `python3.13`,
confirmed to resolve the same 3.13.18 binary) explicitly for every
invocation and verified the version before trusting any result.
