# Security Review — Feature 33: Core Infrastructure (pass 12)

**Prefix:** `CI12` · **Iteration:** 33 · **Reviewed:** 2026-10-30 · **PR:** (recorded after open)

**0 fixed this pass, 0 new findings.** Zero diff since pass 11's merge across
every file this feature tracks.

**Backend:** `app/core/security_middleware.py`, `app/core/config.py`,
`app/core/database.py` — all three byte-identical to pass 11's merge.
**Frontend:** none — no frontend file in this feature's scope changed.
**Migrations:** none.

Watchdog pickup — the dedicated `/loop 30m /security-review` session
(`session_011T1ZyyLrD5HagusgK9uDw2`) was reported unreachable by the operator
starting this run, and confirmed unreachable via `ListAgents` ("No reachable
agents"). No open security-review PR — confirmed via `list_pull_requests`
(state=open), which returned exactly one open PR, unrelated to this rotation
(`#3866`, a push-notification fix on branch `ccr-4657ba41-91jqy1`). PR #3865
(Feature 32, Locations & kiosk, pass 11) had already merged
(`c3b156bdd8e8`) with row 32 already recorded in that merge's own log; there
was nothing left to record from Step 0 beyond clearing the stale **Open PR**
row. Row 33 (Core infrastructure) was confirmed the next `⬜` row by reading
the rotation table directly on a freshly-fetched `main`.

---

## Scope

**Read in full, this pass:** a direct `git diff` of pass 11's merge commit
(`4a4eb2fd`, PR #3790) against current `main` for all three in-scope files,
plus the two adjacent crypto files this feature's prior passes have tracked
by location (`security.py`, `encrypted_types.py`) and the two files every
prior pass has excluded but re-checks the diff of (`cache.py`,
`websocket_manager.py`):

```
git diff 4a4eb2fd..HEAD --stat -- \
  backend/app/core/security_middleware.py backend/app/core/database.py \
  backend/app/core/config.py backend/app/core/security.py \
  backend/app/core/encrypted_types.py backend/app/core/cache.py \
  backend/app/core/websocket_manager.py
```

prints nothing — all seven files are byte-identical to pass 11's merge,
despite **256** non-merge commits landing on `main` in the 2 days between
(`git log 4a4eb2fd..HEAD --oneline | wc -l`). Per Pitfall #19, also checked
whether any of this feature's exported surface gained a new reader without
the dependency itself changing: `rate_limit_passkey` is still applied to
exactly the same five routes in `auth.py` it was at pass 11
(`/mfa/challenge`, `/step-up/passkey-options`,
`/passkeys/register-options`, `/passkeys/{passkey_id}` DELETE,
`/passkeys/recovery-codes`), and `security_middleware.py`'s seven
`scope="..."` rate-limit buckets are unchanged and still collision-free.
`BaseHTTPMiddleware` remains unused outside documenting comments
(`grep -rn "BaseHTTPMiddleware" backend/app` — only `mcp/transport.py`'s
comment explaining why it uses pure ASGI instead, unchanged).

**Not touched this pass, same exclusions as every prior pass:**
`app/core/audit.py` (Feature 28's scope), `app/core/permissions.py`
(Feature 02's scope — this window added 109 lines there, confirmed by
`git diff --stat -- backend/app/core/` to be the only non-zero file under
`app/core/` besides two other out-of-scope files, `public_portal_fields.py`
and `seed.py`; none of the three belongs to this feature).

## Verified good ✅

- **All seven tracked files are byte-identical to pass 11's merge** —
  `git diff 4a4eb2fd..HEAD --stat` against the full list above returns no
  output, confirmed directly rather than inferred from the commit log.
- **`rate_limit_passkey`'s reader set is unchanged** — same 5 call sites in
  `auth.py`, same dedicated assertion at `tests/test_passkeys.py:953-957`
  pinning the route/method/limiter triple.
- **The Alembic chain still has a single head** —
  `validate_migrations.py --strict` reports 678 revisions, one head
  (`f90b1124e6f4`), up from pass 11's 666/`0d9897752425` with no fork.
- **Backend Lint's pinned `flake8`/`black`/`isort` still match
  `requirements.txt`** (7.4.1/26.10.1/9.0.2 in both places) — re-confirmed
  against `.github/workflows/ci.yml`'s own pin comment, CI9-33-1's fix has
  not drifted a fourth time.

## Re-verification of prior findings

- **Redis/DB TLS `CERT_NONE` without a configured CA, and the cache's lack
  of tenant namespacing** (`cache.py`) — unchanged (zero diff, confirmed
  above); both remain **owner-accepted** per the 2026-10-05 decision
  recorded in `KNOWN_LIMITATIONS.md` ("Core infra: fail-open TLS/image
  handling + latent cache isolation gaps"). No re-flag.
- **WebSocket `accept()` precedes auth** (`websocket_manager.py`) —
  unchanged (zero diff); deliberate, so close codes reach the browser, per
  the same KNOWN_LIMITATIONS entry. No re-flag.
- **`optimize_image` fail-open** — already resolved per that same entry
  (item 2, CI-9); `app/utils/image_processing.py` is outside this feature's
  tracked files and was not re-read this pass, consistent with every pass
  since CI-9.
- **MFA recovery-code hashing — correcting a stale carry-forward.** CI9-33
  through CI11-33 repeated "MFA recovery codes 40-bit unsalted SHA-256" as a
  residual item said to live in `security.py`. Checked directly this pass:
  `security.py` has no recovery-code code at all (`grep -n recovery
backend/app/core/security.py` — no match); the hashing lives in
  `app/services/mfa_service.py::hash_recovery_code`, a file outside this
  feature's three tracked files and outside the two adjacent crypto files it
  also tracks. That file's `_RECOVERY_CODE_BYTES = 10` (80 bits, not 40) —
  the entropy was raised in CI-10 itself (shipped in #2722, per
  `KNOWN_LIMITATIONS.md`'s "Crypto: AES-256-GCM + 600k PBKDF2 done; MFA
  recovery-code entropy raised" entry), and an unsalted SHA-256 over an
  80-bit random secret is not a weak hash — brute force still costs the
  full 80-bit search. The "40-bit" figure describes the pre-#2722 state.
  This item is **resolved and out of this feature's scope**; later passes
  should stop carrying it forward as a Core Infrastructure residual.
- **CI3-33-3 (HIGH, FLAGGED at the time) — `REGISTRATION_REQUIRES_APPROVAL`
  had no reader anywhere.** Re-checked `config.py` directly: the setting is
  now in `RETIRED_SETTINGS` (`config.py:86-89`), accepted-and-ignored with
  an explicit message that nothing ever read it and
  `REGISTRATION_ENABLED=false` is the real control. The dict's neighboring
  comment dates the adjacent four-setting retirement to 2026-10-08 (CI3-33-4);
  this entry was retired alongside or before that commit but the original
  `CI3-33-core-infra.md` write-up was never updated to reflect it. **This
  finding is resolved** — recording the correction here per CLAUDE.md's "if
  a finding contradicts a module doc, correct it there too": no
  `KNOWN_LIMITATIONS.md` entry exists for it (correctly — retiring the
  setting is a real fix, not an accepted risk), so there is nothing to edit
  there.

No other historical finding's disposition changed this pass.

## Findings

None this pass.

## Schema & migration notes

No schema change in any of this feature's tracked files. Alembic chain:
678 revisions, single head `f90b1124e6f4` (up from pass 11's 666 revisions,
no fork).

## Guard tests added

None — no new code to guard.

## Completion gate

| Check                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Result                                                         |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `flake8 app/ tests/ alembic/` (7.4.1, CI's pin, via `/usr/bin/python3 -m flake8`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | ✅ 0 violations                                                |
| `black --check app/ tests/ alembic/` (26.10.1, CI's pin)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | ✅ clean, 2,744 files                                          |
| `isort --check-only app/ tests/ alembic/` (9.0.2, CI's pin)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | ✅ clean                                                       |
| `python3 scripts/validate_migrations.py --strict`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | ✅ 678 revisions, single head `f90b1124e6f4`                   |
| Feature-scoped tests (`test_security_middleware.py`, `test_core_infra_boot_checks.py`, `test_database_manager.py`, `test_database_url_encoding.py`, `test_tls_setup.py`, `test_session_limits.py`, `test_mfa_policy.py`, `test_s3_storage.py`, `test_openapi_contract.py`, `test_config_retired_settings.py`, `test_compose_settings_passthrough.py`, `test_startup_diagnostics.py`, `test_passkeys.py`, `test_rotate_email_fingerprints.py`, `test_email_fingerprint.py`, `test_encrypt_email_migration.py`, `test_encryption_registry_coverage.py`) | ✅ 609 passed, 1 skipped (pre-existing, "root reads any file") |
| Cross-cutting guard tests (`test_like_escaping.py`, `test_csv_writer_sweep.py`, `test_database_schema.py`, `test_org_scoping_ratchet.py`, `test_capacity_locking.py`, `test_endpoint_auth_coverage.py`, `test_api_cache_pii_exclusions.py`, `test_migration_create_all_tables.py`, `test_baseline_member_grants.py`, `test_alembic_migrations.py`, `test_account_status_gates.py`)                                                                                                                                                                    | ✅ 242 passed                                                  |
| `cd frontend && npm run typecheck`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | n/a — no frontend file touched this pass                       |
| `cd frontend && npm run lint`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | n/a — no frontend file touched this pass                       |

**Environment note:** backend tooling (`flake8`/`black`/`isort`) resolved
under `/usr/local/bin/python3` (a symlink to `/usr/bin/python3.11`) by
default, which is a _different_ interpreter than `/usr/bin/python3`
(3.13.17, matching `requirements.txt`'s pins) — a bare `pip install` landed
the packages under the 3.13 site-packages while `python3 -m flake8`
resolved the 3.11 interpreter with nothing installed. Used
`/usr/bin/python3 -m <tool>` explicitly for every invocation, same as
CI9-33/CI11-33, and verified it resolves 3.13.17 before trusting the result.
