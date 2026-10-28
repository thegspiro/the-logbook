# Security Review — Feature 33: Core Infrastructure (pass 10)

**Prefix:** `CI10` · **Iteration:** 33 · **Reviewed:** 2026-10-28 · **PR:** (recorded after open)

**1 fixed this pass** (CI10-33-1, a guard-test gap in a new crypto primitive
this feature owns), **0 new application findings.**

**Backend:** `app/core/security_middleware.py` (+23 lines since pass 9's
baseline). `app/core/config.py` and `app/core/database.py` are byte-identical
— confirmed with dedicated `git diff 8ae42b51..HEAD` on each, which printed
nothing for both.
**Frontend:** none this pass — no frontend file in this feature's scope
changed.
**Migrations:** none owned by these three files directly this pass, but
`20261026_1211_b8236e29ec44_encrypt_email_addresses_at_rest.py` landed in
this window and is read below because it is the consumer of two new
primitives this feature's own `security.py`/`encrypted_types.py` gained in
the same window (see Scope).

This is the rotation's tenth pass on Core Infrastructure, following
[`CI9-33`](./CI9-33-core-infra.md) (2026-10-25, PR #3681). Watchdog
pickup — the dedicated `/loop 30m /security-review` session
(`session_011T1ZyyLrD5HagusgK9uDw2`) was reported unreachable by the
operator starting this run, and confirmed unreachable via `ListAgents` (no
agent of that name running). No open security-review PR — confirmed via
`search_pull_requests` (`is:pr is:open head:claude/security-review-`), 0
results, and via `list_pull_requests` (state=open), which returned only two
unrelated docs PRs (#3774/#3772), both checked immediately before starting.
PR #3787 (Feature 32, Locations & kiosk, pass 10) had already merged
(`6c27ea21`) with row 32 already `✅` in that merge commit, so there was
nothing left to record from Step 0 beyond clearing the stale Open PR note.
Row 33 (Core infrastructure) was confirmed the next `⬜` row by reading the
rotation table directly on a freshly-fetched `main`.

---

## Scope

**Read in full, this pass:** a direct `git diff` of pass 9's merge commit
(`8ae42b51`, PR #3681) against current `main` for all three in-scope files.
`config.py` and `database.py` have zero lines of diff. `security_middleware.py`'s
diff is 23 lines, all of it read:

- **`security_middleware.py` (+23):** one new rate limiter,
  `rate_limit_passkey()` — 20 requests/60s per the shared `check_rate_limit`
  keying, `lockout_seconds=600`, on its own `scope="passkey"` bucket, kept
  off the `login` bucket on purpose (the dependency's own docstring explains
  why: issuing a passkey challenge proves nothing, and the sign-in screen
  re-fetches one after every cancelled or failed prompt, so counting it
  against login's 5/min would lock a station's shared address out of signing
  in — the routes that actually check a credential stay on the `login`
  bucket). Confirmed the bucket name doesn't collide with any of the other
  six (`login`, `register`, `password_reset`, `password_reset_token`,
  `token_refresh`, `password_change`) by listing every `scope="..."` literal
  in the file.

Because `rate_limit_passkey` is new shared infrastructure, Pitfall #19
requires tracing its readers even though they live outside this feature's
three files: `grep -rn rate_limit_passkey backend/app` shows it applied to
exactly five routes in `auth.py` — `/mfa/challenge`,
`/step-up/passkey-options`, `/passkeys/register-options`,
`/passkeys/{passkey_id}` (DELETE), `/passkeys/recovery-codes` — each read at
its call site to confirm the dependency fires before any DB/crypto work, and
all five are pinned by an existing dedicated assertion in
`tests/test_passkeys.py` (lines 953-957) that checks the route/method/limiter
triple directly, so a future route added to the passkey surface without this
limiter fails that test rather than shipping unlimited.

**Read in full, adjacent to this feature's crypto primitives:** `security.py`
and `encrypted_types.py` are not this feature's principal files, but every
prior pass has tracked this feature's own standing findings by their location
in exactly these two files (DB/Redis TLS, MFA recovery-code hashing, the
email/blind-index work noted by Feature 30 and Feature 32's own passes), so a
diff on either is this feature's business to read. Both changed substantially
in this window — `security.py` (+66 lines: `email_fingerprint()`,
`email_fingerprints()`, `normalize_email()`, HKDF-derived fingerprint keys)
and `encrypted_types.py` (+72 lines: `EncryptedDate`, `keep_email_fingerprint`)
— both introduced by `b8236e29ec44`'s email-at-rest-encryption migration.
Read in full, together with the migration itself, `rotate_encryption_key.py`'s
`_FINGERPRINT_COLUMNS` list, and every one of the five `keep_email_fingerprint`
call sites (`user.py`, `membership_pipeline.py`, `event.py`, `grant.py`,
`storefront.py`).

**Not touched this pass, same exclusions as every prior pass:** `cache.py`
(this window's diff is empty for it — `git diff 8ae42b51..HEAD --
backend/app/core/cache.py` prints nothing), `websocket_manager.py` (empty
diff), `app/core/audit.py` (Feature 28's scope), `app/core/permissions.py`
(Feature 02's scope — this window added `SENSITIVE_ANSWERS_VIEW`, a Forms
permission, confirmed unrelated to this feature by reading the diff).

## New code reviewed fresh

**The email blind-index primitive (`security.py`):**

- `email_fingerprint(value)` is a keyed HMAC-SHA256 of the normalized
  (stripped, lower-cased) address, never a plain hash — the module's own
  comment states why: email addresses are guessable, so an unkeyed SHA-256 in
  a stolen dump could be reversed by hashing a candidate list, exactly the
  attack a keyed MAC defeats. The key is HKDF-derived from `ENCRYPTION_KEY`
  under a distinct info label (`logbook:email-fingerprint:v1`), so it is
  provably not the AES-GCM content key and needs no setting of its own.
  Confirmed `reset_encryption_ciphers()` clears the new `_fingerprint_keys`
  cache alongside the existing cipher caches, so a key rotation in the same
  process (as the test suite does) can't serve a stale derived key.
- `email_fingerprints(value)` returns the fingerprint under the current key
  **and** every key in `ENCRYPTION_KEYS_LEGACY`, de-duplicated. This is what
  lets a lookup by email keep matching rows written before the most recent
  key rotation, for as long as the old key stays in the legacy ring — the
  correct design, verified against `tests/test_rotate_email_fingerprints.py`,
  which demonstrates both halves: dropping the legacy key before rotating
  loses the row (`test_without_the_rotation_dropping_the_old_key_loses_the_row`),
  and running the rotation script first lets the legacy key be dropped safely
  (`test_after_the_rotation_the_old_key_can_go`).
- `keep_email_fingerprint(Model.email_attr, "fingerprint_col")` is an
  SQLAlchemy `"set"` attribute-event listener that recomputes the fingerprint
  column on every ORM assignment of the email attribute, including
  construction. Its own docstring correctly warns that a bulk
  `update().values(email=...)` bypasses attribute events and must set the
  fingerprint itself — checked every call site that updates one of the five
  wired columns (`user.py`, `membership_pipeline.py`, `event.py`, `grant.py`,
  `storefront.py`'s services) for a bulk `.update()`/`execute(update(...))`
  against `email`/`customer_email`: none exists: every write goes through the
  ORM attribute, so the listener always fires.

**`EncryptedDate` (`encrypted_types.py`):** a calendar date stored as
encrypted ISO-8601 text, mirroring the existing `EncryptedText`/`EncryptedJSON`
pattern — same "legacy plaintext passes through, anything else that fails to
decrypt propagates" fail-open-to-the-old-column, fail-closed-on-corruption
shape as its siblings. Its bind-side validation rejects anything that isn't a
`date`/`datetime`/ISO date string with a message that deliberately omits the
value (the type's own comment: a date of birth must not end up in an
exception message and from there in a log — consistent with Pitfall #33's "an
id rather than user-supplied text" rule, applied here to a value rather than
free text).

## Verified good ✅

- **The new `EncryptedDate` type is caught by the existing registry-coverage
  mechanism automatically** — `test_encryption_registry_coverage.py` builds
  its column set with `isinstance(column.type, (EncryptedDate, EncryptedJSON,
EncryptedText))`, a type check against live model metadata rather than a
  hand-written list, so introducing a new `EncryptedDate` column needs no
  companion edit to that test to be covered by it. Re-ran it: 7 passed (2 of
  those 7 are this pass's own addition, see Findings).
- **`rate_limit_passkey`'s bucket cannot be starved by the login bucket, or
  vice versa** — confirmed by listing every `scope="..."` literal in
  `security_middleware.py`: seven distinct names, no collisions.
- **Every `keep_email_fingerprint`-wired column has a matching entry in
  `rotate_encryption_key.py`'s `_FINGERPRINT_COLUMNS`, today** — verified by
  hand (5 call sites, 5 list entries, same five `(table, column)` pairs) and
  now also by this pass's own new guard test (see Findings), which was not
  true as an enforced invariant before this pass — only as a coincidence of
  the two lists currently agreeing.
- **`BaseHTTPMiddleware` has zero real usages** in the three in-scope files
  (re-confirmed by fresh `grep -rn "BaseHTTPMiddleware"` — only documenting
  comments, unchanged from every prior pass).
- **The Alembic chain has a single head** — `validate_migrations.py --strict`
  reports 666 revisions, one head (`0d9897752425`), no repeat of the
  forked-head incident this rotation has hit before.
- **Backend Lint's pinned `flake8`/`black`/`isort` still match
  `requirements.txt`** (7.4.1/26.10.1/9.0.2 in both places) — CI9-33-1's fix
  has not drifted again.

## Re-verification of prior findings

The three historical open/flagged items as of CI8-33 (DB/Redis TLS WARN-only
in prod, `optimize_image` fail-open, Redis `CERT_NONE` without a configured
CA) and CI-10's residual items (no cache tenant namespacing, WS `accept()`
before auth, MFA recovery codes 40-bit unsalted SHA-256) live in
`security.py` (the MFA recovery-code item) or in `cache.py`/
`websocket_manager.py` (unchanged this window, confirmed by empty diffs
above). Re-checked the MFA recovery-code item's location directly: unchanged
— this window's `security.py` diff is additive (the new fingerprint section)
and does not touch the recovery-code hashing code above it. Nothing to
re-litigate; all re-confirmed at their prior disposition.

## Findings

### CI10-33-1 — LOW (test-coverage gap, not an application defect) — `_FINGERPRINT_COLUMNS` had no guard against drifting from `keep_email_fingerprint`'s actual call sites — ✅ FIXED

**What:** `rotate_encryption_key.py`'s email-fingerprint rotation targets
(`_FINGERPRINT_COLUMNS`, a hand-written list of `(table, address, fingerprint)`
triples) have no automated check against the real set of columns wired up by
`keep_email_fingerprint(...)` calls across `app/models/`. The equivalent
ciphertext-column list (`_PLAIN_COLUMNS`, covering `EncryptedText`/
`EncryptedJSON`/`EncryptedDate`) already has exactly this check —
`test_encryption_registry_coverage.py`'s `test_every_encrypted_column_is_in_the_script`
— built from a type scan over live model metadata, so it catches a forgotten
column automatically rather than by review. The fingerprint list had no
analogous test.
**Where:** `backend/scripts/rotate_encryption_key.py:208-214`
(`_FINGERPRINT_COLUMNS`) vs. the five `keep_email_fingerprint(...)` call sites
in `app/models/{user,membership_pipeline,event,grant,storefront}.py`.
**Failure scenario:** a future model adds `keep_email_fingerprint(Model.email,
"email_hash")` without a matching entry in `_FINGERPRINT_COLUMNS`. Nothing
fails immediately — `email_fingerprints()` still matches rows via every
legacy key, so lookups keep working right up until an operator runs
`rotate_encryption_key.py --commit` and then retires the old key from
`ENCRYPTION_KEYS_LEGACY` (exactly the documented, intended operational
sequence). From that point, every row of the forgotten column whose
fingerprint was never recomputed stops matching on email — a silent "we don't
recognize that address" for real members/applicants/customers, discovered
only when someone can't sign in or can't be found, long after the change
that caused it.
**Impact:** availability/correctness, not confidentiality — a fingerprint
mismatch fails closed (no match), so this cannot produce a false positive or
leak another row; it produces a false negative on legitimate lookups after a
future key rotation, for a column nobody remembered to list. Today, the two
lists agree (5 call sites, 5 entries, same tables and columns), so there is
no live exposure — this is a guard against the next person who adds a sixth.
**Fix:** added `test_every_keep_email_fingerprint_call_is_in_the_rotation_script`
and `test_fingerprint_registry_names_no_column_that_is_not_wired` to
`tests/test_encryption_registry_coverage.py`. Both scan `app/models/*.py` by
AST for `keep_email_fingerprint(Model.attr, "name")` calls, resolve `Model`
through the live SQLAlchemy declarative registry (`Base.registry.mappers`) to
its real table name — so a renamed model or attribute is still caught, not
just a renamed call — and diff the resulting `(table, fingerprint_column)`
set against `_FINGERPRINT_COLUMNS` in both directions (missing, and stale).
Ran against current `main`: both pass today, confirming the two lists
already agree; either test fails the moment they stop agreeing.

No other historical finding's disposition changed this pass.

## Schema & migration notes

No schema change in `config.py`/`security_middleware.py`/`database.py`
themselves this pass. The one migration read in this window
(`20261026_1211_b8236e29ec44`, email-at-rest encryption) belongs to the
feature(s) that own the tables it alters, not to Core Infrastructure — read
here only because it is the sole consumer of the two new primitives this
feature's `security.py`/`encrypted_types.py` gained. It already handles
existing rows correctly (Pitfall #35): it pre-checks for duplicate addresses
under the new case/whitespace-normalized comparison before altering anything
and refuses with the offending row ids rather than silently merging or
dropping data, it is idempotent (a value already carrying the ciphertext
prefix is decrypted to compute its fingerprint rather than re-encrypted), and
it refuses to run with rows to encrypt but no `ENCRYPTION_KEY` configured
rather than writing unreadable ciphertext. `validate_migrations.py --strict`
reports a single head (`0d9897752425`, 666 revisions) — no forked-head repeat
of the recurring parallel-merge pattern this rotation has hit before.

## Guard tests added

- `tests/test_encryption_registry_coverage.py::test_every_keep_email_fingerprint_call_is_in_the_rotation_script`
  — a model wired for blind-index email lookup must have a matching
  `_FINGERPRINT_COLUMNS` entry, checked by AST + live model metadata rather
  than by review (CI10-33-1).
- `tests/test_encryption_registry_coverage.py::test_fingerprint_registry_names_no_column_that_is_not_wired`
  — the reverse direction: `_FINGERPRINT_COLUMNS` names no column that isn't
  actually wired up any more.

## Completion gate

| Check                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Result                                                                                                 |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `flake8 app/ tests/ alembic/` (7.4.1, CI's pin)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | ✅ 0 violations                                                                                        |
| `black --check app/ tests/ alembic/` (26.10.1, CI's pin)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | ✅ clean (1 file this pass's own edit reformatted to match, then re-verified clean), 2,706 files total |
| `isort --check-only app/ tests/ alembic/` (9.0.2, CI's pin)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | ✅ clean                                                                                               |
| `python3 scripts/validate_migrations.py --strict`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | ✅ 666 revisions, single head `0d9897752425`                                                           |
| Feature-scoped tests (`test_security_middleware.py`, `test_core_infra_boot_checks.py`, `test_database_manager.py`, `test_database_url_encoding.py`, `test_tls_setup.py`, `test_session_limits.py`, `test_mfa_policy.py`, `test_s3_storage.py`, `test_openapi_contract.py`, `test_config_retired_settings.py`, `test_compose_settings_passthrough.py`, `test_startup_diagnostics.py`, `test_passkeys.py`, `test_rotate_email_fingerprints.py`, `test_email_fingerprint.py`, `test_encrypt_email_migration.py`, `test_encryption_registry_coverage.py`) | ✅ 605 passed, 1 skipped (pre-existing, "root reads any file")                                         |
| Cross-cutting guard tests (`test_like_escaping.py`, `test_csv_writer_sweep.py`, `test_database_schema.py`, `test_org_scoping_ratchet.py`, `test_capacity_locking.py`, `test_endpoint_auth_coverage.py`, `test_api_cache_pii_exclusions.py`, `test_migration_create_all_tables.py`, `test_baseline_member_grants.py`, `test_alembic_migrations.py`, `test_account_status_gates.py`)                                                                                                                                                                    | ✅ 242 passed                                                                                          |
| `cd frontend && npm run typecheck`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | n/a — no frontend file touched this pass                                                               |
| `cd frontend && npm run lint`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | n/a — no frontend file touched this pass                                                               |

**Environment note:** backend tooling (`flake8`/`black`/`isort`) resolved
under `/usr/bin/python3` (3.13), matching `requirements.txt`'s pins; used
`/usr/bin/python3 -m <tool>` explicitly for every invocation, same as CI9-33.
