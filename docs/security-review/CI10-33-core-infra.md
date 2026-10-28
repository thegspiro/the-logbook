# Security Review — Feature 33: Core Infrastructure (pass 10)

**Prefix:** `CI10` · **Iteration:** 33 · **Reviewed:** 2026-10-28 · **PR:** (recorded after open)

**0 fixed, 0 new findings.** This is a plumbing feature with no routes of
its own to enumerate; the seven checklist dimensions are worked against the
middleware/config/database layer's own invariants instead (see below).

**Backend:** `app/core/security_middleware.py` (+23 lines since pass 9's
baseline — one new rate-limit dependency). `app/core/config.py` and
`app/core/database.py` are byte-identical to pass 9's merge — confirmed with
`git diff 8ae42b51..HEAD -- backend/app/core/config.py backend/app/core/database.py`,
which printed nothing.
**Frontend:** none this pass — no frontend file in this feature's scope changed.
**Migrations:** none owned by these three files; `validate_migrations.py
--strict` reports 666 revisions (up from 651 at pass 9), single head
`0d9897752425`, no forked head.

This is the rotation's tenth pass on Core Infrastructure, following
[`CI-33`](./CI-33-core-infra.md) (2026-08-31) through
[`CI9-33`](./CI9-33-core-infra.md) (2026-10-25, PR #3681, merge `8ae42b51`).
**Watchdog pickup** — the dedicated `/loop 30m /security-review` session for
this rotation was reported unreachable. Re-verified fresh, immediately before
starting: `git fetch origin main` (head `6c27ea21`) and
`search_pull_requests` (`is:open is:pr head:claude/security-review-`,
`thegspiro/the-logbook`) returned **0 results** — no security-review PR
open. PR #3787 (Feature 32, Locations & kiosk, pass 10) had already merged
and `PROGRESS.md`'s rotation table on this fetched `main` already carried row
32 at ✅ with row 33 (Core infrastructure) the next `⬜`, confirmed by reading
the table directly rather than trusting the Open PR narrative section.

---

## Scope

**Read in full, this pass:** a direct `git diff` of pass 9's merge commit
(`8ae42b51`, PR #3681) against current `main` for all three in-scope files —
`config.py`/`database.py` are empty diffs, `security_middleware.py`'s 23-line
diff was read in full, together with every call site of the new dependency
(`backend/app/api/v1/endpoints/auth.py`, 5 call sites) and its own guard test
(`tests/test_passkeys.py`).

**Also read, because they are genuinely infrastructure-level and changed in
this window even though they live in adjacent files this feature's prior
passes have tracked by git-diff rather than by ownership:**
`app/core/security.py` (+66 lines: a new keyed email-blind-index primitive —
`email_fingerprint`/`email_fingerprints`/`normalize_email`, built on HKDF +
HMAC-SHA256) and `app/core/encrypted_types.py` (+72 lines: a new
`EncryptedDate` column type, and `keep_email_fingerprint`, the SQLAlchemy
attribute-event helper that recomputes a model's fingerprint column on every
ORM-level email assignment). Both are encryption-key-handling primitives —
squarely this feature's "encryption key handling" remit — not merely
unrelated churn in an adjacent file. `app/core/utils.py` (+47 lines: a named
`MAX_ERROR_DETAIL_LENGTH` constant replacing a bare `300`, and
`list_within_detail_limit`, a bounded-length list-join helper for refusal
messages) is core infra's own error-handling utility and was read in full.

**Deliberately not re-reviewed at the application layer:** the ~20 models and
services that now call `email_fingerprint`/`email_fingerprints`
(`app/models/user.py`, `event.py`, `grant.py`, `storefront.py`,
`membership_pipeline.py`, `auth_service.py`, and others) are each owned by
their own rotation feature, and the email-encryption-at-rest rollout they
belong to was already under active review this same week —
[`LOC10-32-locations-kiosk.md`](./LOC10-32-locations-kiosk.md) (pass 10,
merged as part of PR #3787, `main` tip `6c27ea21`) found and fixed a real
ciphertext-vs-plaintext comparison bug in this exact rollout and flagged two
residual items (a test-fixture gap, a cross-feature log line in
`membership_pipeline_service.py`). This pass's job is the primitive those
consumers call, not re-auditing every consumer; `auth_service.py`'s own
substitutions (`User.email == email` → `User.email_hash.in_(email_fingerprints(email))`,
diffed below) were spot-read only far enough to confirm the primitive's real
usage preserves the pre-existing `organization_id` filter at each call site —
full authentication-flow review stays with Core Infra's companion Users/Auth
feature.

**Not touched this pass, same exclusions as every prior pass:** `cache.py`,
`websocket_manager.py` — confirmed byte-identical to pass 9 via
`git diff 8ae42b51..HEAD`, which printed nothing for both. `app/core/audit.py`
(Feature 28's scope), `app/core/permissions.py` (Feature 02's scope) — the
latter did change this pass (+13 lines, a new `sensitive_answers.view`
permission for the Forms feature) but is explicitly out of this feature's
ownership per every prior pass's stated scope split; confirmed the new grant
is seeded to no position (`grep -rn "sensitive_answers" backend/app/core/seed.py`
— no hit), so it carries no Pitfall #23 migration obligation. `error_codes.py`
(+17 lines) and `error_reporting.py` (+5 lines) also changed but are
feature-specific additions (a new Events error code, a new Events guest-token
redaction pattern) riding in files that happen to live under `app/core/`;
noted for completeness, owned by the Events feature.

## New code reviewed fresh

- **`rate_limit_passkey()`** (`security_middleware.py:1091-1109`) — 20
  requests / 60s, 600s lockout, its own `scope="passkey"` bucket, kept off the
  login bucket by design (issuing a WebAuthn challenge proves nothing, and a
  cancelled prompt re-fetches one, so counting it against login's 5/min would
  lock a shared kiosk address out of signing in). Used at 5 call sites in
  `auth.py`: `POST /mfa/challenge` (pre-auth, paired with
  `Depends(enforce_suspicious_ip)` — correct, since this is the one call site
  reachable before `get_current_active_user` exists), and
  `POST /step-up/passkey-options`, `POST /passkeys/register-options`,
  `DELETE /passkeys/{passkey_id}`, `POST /passkeys/recovery-codes` (all
  `Depends(get_current_active_user)`-gated). Auth coverage dimension: no gap —
  the one dependency-free-looking route is intentionally public with its
  compensating control (rate limit + suspicious-IP throttle) named explicitly
  in its own docstring. Routed through the same `check_rate_limit` used by
  every other bucket, which SEC-00's baseline already confirmed bounded
  (`_MAX_KEYS` cap + LRU eviction) — adding a new `scope` string does not add
  a new unbounded structure, it adds entries to the existing capped one.
  Covered by `tests/test_passkeys.py`.

- **Email blind index** (`security.py:656-722`) — `email_fingerprint`/
  `email_fingerprints` are a **keyed** HMAC-SHA256 (key derived from
  `ENCRYPTION_KEY` via HKDF with its own `info` label, never the AES data key
  itself), not a plain hash — the design doc comment is correct that an
  unkeyed SHA-256 blind index would let a stolen dump be reversed by hashing a
  candidate list of emails, and a keyed one cannot be. `email_fingerprints`
  (plural) returns one fingerprint per key in `[current, *legacy]`, so a
  lookup still matches a row whose fingerprint was computed under a key that
  has since rotated out, provided it is still in the legacy ring — exactly the
  same "decrypt-ring" shape `_get_legacy_aesgcm`/`_get_legacy_fernet` already
  use for ciphertext, just applied to an HMAC instead of a cipher.
  `_fingerprint_keys` (the derived-key cache) is keyed by the raw settings
  string, bounded by the operator-configured number of current + legacy keys
  (never attacker input) — not a Pitfall #9 concern, same shape as the
  pre-existing `_legacy_aesgcms`/`_legacy_fernets` caches. `reset_encryption_ciphers()`
  clears it alongside every other cipher cache, so a key-rotation test or a
  mid-process `ENCRYPTION_KEY` change cannot read a stale derived key.
  `normalize_email` (`.strip().lower()`) is documented to match the prior
  plaintext column's case-insensitive, trailing-space-insensitive MySQL
  collation — the right thing to preserve, since changing it silently would
  make two previously-equal addresses compare unequal.

- **`EncryptedDate`** (`encrypted_types.py:109-156`) — the same
  `TypeDecorator` shape as the pre-existing `EncryptedText`/`EncryptedJSON`:
  Python-side `datetime.date` on both ends, ISO-8601 text as the plaintext the
  cipher wraps, and a value that fails to decrypt with `InvalidToken` falls
  back to reading the raw column text as a pre-migration plain `DATE` value
  (so the application keeps serving existing rows correctly before a backfill
  runs) while any other decrypt failure propagates rather than silently
  returning a wrong date. A malformed input's `ValueError` is deliberately
  raised **without** the offending value in the message — correct, since a
  date of birth in an exception message would reach the log the moment
  `safe_error_detail()` or an unhandled-exception handler formats it.

- **`keep_email_fingerprint`** (`encrypted_types.py:158-172`) — a SQLAlchemy
  attribute `"set"` event, which fires on an explicit assignment (including
  inside `__init__`) but — confirmed against SQLAlchemy's own documented
  behavior, not assumed — **not** on the ORM's own row-hydration path (which
  uses `set_committed_value`, a different code path that deliberately bypasses
  attribute events so a `SELECT` doesn't re-run every model's business logic
  on load). So loading a row does not recompute and rewrite its fingerprint on
  every read; only a real write recomputes it. The docstring's own caveat — a
  bulk `update().values(email=...)` bypasses the event and must set the
  fingerprint itself — was checked against `rotate_encryption_key.py`'s
  `_rotate_fingerprints`, which does exactly that with a raw `UPDATE`
  (correctly, since that script runs outside the ORM entirely).

- **`list_within_detail_limit`/`MAX_ERROR_DETAIL_LENGTH`** (`utils.py:36-109`)
  — a pure refactor of the existing `safe_error_detail`/`sanitize_error_message`
  300-char cap into a named constant, plus a new helper with two real
  consumers (`equipment_check_service.py`, `scheduling.py`) and its own test
  file (`tests/test_safe_error_detail.py`). The result is provably bounded:
  the loop only keeps adding items while the candidate string (including the
  "and N more" suffix for whatever remains) still fits under the cap, and the
  single-item overflow branch clips and ellipsizes rather than ever emitting
  a string past the limit.

## Verified good ✅

- **`BaseHTTPMiddleware` has zero real usages** in the three in-scope files
  and in every adjacent file touched this pass (re-confirmed by fresh
  `grep -rn "BaseHTTPMiddleware"` across `app/core/` — only documenting
  comments, unchanged from every prior pass).
- **The middleware stack's registration order is unchanged** — `main.py`'s
  diff against pass 9 is a new public router inclusion for an unrelated
  feature (Events' guest QR code API), not a reordering of any security
  middleware.
- **No new unbounded in-memory tracking structure was added this pass** —
  `rate_limit_passkey` adds a bucket name to the existing capped/evicted
  `check_rate_limit` store; `_fingerprint_keys` is bounded by the small,
  operator-configured set of current + legacy encryption keys, the same shape
  as the pre-existing cipher caches it sits beside.
- **The new email blind index cannot be reversed from a stolen fingerprint
  dump alone** — it is a keyed HMAC (key derived via HKDF from
  `ENCRYPTION_KEY`, never reused as the AES key), not a plain hash of a
  guessable input.
- **A date-of-birth value never reaches an exception message** —
  `EncryptedDate`'s `ValueError` on a malformed input omits the value by
  design, matching this feature's existing `safe_error_detail()` discipline.
- **`auth_service.py`'s migration from `User.email == email` to
  `User.email_hash.in_(email_fingerprints(email))`** (4 call sites diffed
  against pass 9) preserves every pre-existing `organization_id`/
  `deleted_at`/`Organization.active` filter at each site — the substitution
  changed only the matching mechanism, not the tenancy scope. (Full
  authentication-flow correctness remains that feature's own scope; this is
  confirmation the primitive's adoption didn't regress Core Infra's own
  org-scoping expectations.)
- **`config.py`/`database.py` carry forward every invariant certified by
  passes 1–9 unchanged** — byte-identical `git diff` against pass 9's merge
  commit for both files.

## Re-verification of prior findings

All historical open/flagged items are unchanged, confirmed by reading each
one's named location fresh rather than trusted from the prior write-up:

- **CI-9/CI-10 residual ops/design items** (DB/Redis TLS WARN-only-in-prod
  boundary now governed by `SECURITY_REQUIRE_TLS`, Redis `CERT_NONE` without a
  configured CA, no Redis cache tenant namespacing, WebSocket `accept()`
  before auth, MFA recovery-code entropy) — all five live in `cache.py` /
  `websocket_manager.py` / `security.py`, which (aside from this pass's new
  additions, none of which touch these specific lines) are byte-identical to
  pass 9. `docs/KNOWN_LIMITATIONS.md`'s "Core infra: fail-open TLS/image
  handling + latent cache isolation gaps" and "Crypto: AES-256-GCM + 600k
  PBKDF2 done; MFA recovery-code entropy raised" rows already carry the
  owner's 2026-10-05 "accepted as-is" decision on the Redis items — nothing to
  re-flag, nothing to mirror (already mirrored).
- **CI9-33-1** (Backend Lint's pinned linters drifted from `requirements.txt`)
  — ✅ confirmed still fixed: `.github/workflows/ci.yml:126` pins
  `flake8==7.4.1`/`black==26.10.1`/`isort==9.0.2`, identical to
  `backend/requirements.txt:173-184`, and both match this pass's own
  completion-gate run below.

No other historical finding's disposition changed this pass.

## Findings

None — no new finding this pass. The only in-scope-file change
(`rate_limit_passkey`) and the adjacent encryption-primitive additions
(`email_fingerprint`/`EncryptedDate`/`keep_email_fingerprint`) were each
reviewed fresh above and verified good, with a real reader, a real test, and
(for the email-encryption rollout they support) an active companion review
elsewhere in the rotation that already found and fixed the one real defect in
that rollout's application-layer adoption.

## Schema & migration notes

No schema change in `config.py`/`security_middleware.py`/`database.py`
themselves this pass. The email-fingerprint and `EncryptedDate` primitives
this pass reviewed are consumed by migrations outside this feature's three
files (`...b8236e29ec44_encrypt_email_addresses_at_rest.py`,
`...3e8071e_encrypt_date_of_birth_and_emergency_.py`,
`...0d5ff49eb_encrypt_contact_phone_numbers_and_.py`) — those migrations'
own backfill correctness (Pitfall #35: settling existing rows, not merely
adding a column) is each consuming feature's own schema-review scope, not
re-derived here; `validate_migrations.py --strict` confirms the whole chain
(including the three merge-commits those parallel migrations needed) resolves
to a single head with no duplicate revision id.

## Guard tests added

None by this pass — every invariant checked above already has a guard test
from the commit that introduced it (`tests/test_passkeys.py`,
`tests/test_email_fingerprint.py`, `tests/test_encrypted_types.py`,
`tests/test_rotate_email_fingerprints.py`, `tests/test_safe_error_detail.py`),
all re-confirmed passing below.

## Completion gate

| Check                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Result                                                                                                  |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `flake8 app/ tests/ alembic/` (7.4.1, matches CI's pin)                                                                                                                                                                                                                                                                                                                                                                                                                                       | ✅ 0 violations                                                                                         |
| `black --check app/ tests/ alembic/` (26.10.1, matches CI's pin)                                                                                                                                                                                                                                                                                                                                                                                                                              | ✅ clean, 2,706 files unchanged                                                                         |
| `isort --check-only app/ tests/ alembic/` (9.0.2, matches CI's pin)                                                                                                                                                                                                                                                                                                                                                                                                                           | ✅ clean                                                                                                |
| `python3 scripts/validate_migrations.py --strict`                                                                                                                                                                                                                                                                                                                                                                                                                                             | ✅ 666 revisions, single head `0d9897752425`                                                            |
| Feature-scoped tests (`test_security_middleware.py`, `test_core_infra_boot_checks.py`, `test_database_manager.py`, `test_database_url_encoding.py`, `test_tls_setup.py`, `test_session_limits.py`, `test_mfa_policy.py`, `test_s3_storage.py`, `test_openapi_contract.py`, `test_config_retired_settings.py`, `test_compose_settings_passthrough.py`, `test_startup_diagnostics.py`, `test_safe_error_detail.py`, `test_passkeys.py`, `test_email_fingerprint.py`, `test_encrypted_types.py`) | ✅ 627 passed, 2 skipped (both pre-existing: "root reads any file", optional `pywebpush` not installed) |
| Cross-cutting guard tests (`test_like_escaping.py`, `test_csv_writer_sweep.py`, `test_database_schema.py`, `test_org_scoping_ratchet.py`, `test_capacity_locking.py`, `test_endpoint_auth_coverage.py`, `test_api_cache_pii_exclusions.py`, `test_migration_create_all_tables.py`, `test_baseline_member_grants.py`, `test_alembic_migrations.py`, `test_account_status_gates.py`)                                                                                                            | ✅ 242 passed                                                                                           |
| `cd frontend && npm run typecheck`                                                                                                                                                                                                                                                                                                                                                                                                                                                            | ✅ clean, no output                                                                                     |
| `cd frontend && npm run lint`                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | ✅ clean, no output (max-warnings 10)                                                                   |

**Environment note:** backend tooling (`flake8`/`black`/`isort`) resolves
under `/usr/bin/python3` (3.13) at exactly CI's pinned versions
(7.4.1/26.10.1/9.0.2) — confirmed with `/usr/bin/python3 -m <tool> --version`
before running the gate, so no version drift to report this pass.
