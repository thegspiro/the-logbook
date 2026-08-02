# Runbook — AES-256-GCM Field-Encryption Backfill

**Script:** `backend/scripts/reencrypt_to_aesgcm.py`
**Audience:** operator / DBA with shell access to the backend container
**Estimated downtime:** none (the app reads both formats throughout)
**Reversible:** the data change is one-directional, but safe — see
[Rollback & safety](#rollback--safety).

---

## 1. Background — why this is safe

As of the AES-256-GCM migration, `encrypt_data()` writes **AES-256-GCM** and
`decrypt_data()` transparently reads **both** the GCM format **and** the legacy
Fernet (AES-128-CBC + HMAC) format.

> **Version markers (updated 2026-08-01).** New writes are `$gcm2$`, whose key
> is derived at 600,000 PBKDF2 iterations. `$gcm1$` values — same cipher, key
> derived at the previous 100,000 — stay readable forever: the iteration count
> is part of a value's identity, so both counts are permanent. Anywhere this
> runbook says `$gcm1$`, read it as "either GCM marker". The
application is therefore fully correct **without ever running this script** —
existing Fernet ciphertext stays readable indefinitely.

This backfill is the optional Phase-2 step: it rewrites every remaining
legacy value as AES-256-GCM so that, once complete and verified, Fernet
read-support can eventually be retired. Because every value it writes is a form
`decrypt_data()` can read, and because it **skips values already in GCM form**, a
partial or interrupted run is safe and simply resumable.

It also upgrades any *legacy plaintext* found in an encrypted column (rows
written before encryption existed) to AES-256-GCM.

### Fields covered
| Table | Column(s) | Format |
|-------|-----------|--------|
| `shift_completion_reports` | `areas_of_strength`, `areas_for_improvement`, `officer_narrative`, `reviewer_notes` | single ciphertext |
| `users` | `mfa_secret` | single ciphertext |
| `users` | `mfa_backup_codes` | JSON array of ciphertext strings |
| `integrations` | `encrypted_config` | single ciphertext (JSON blob) |
| `external_training_providers` | `api_key`, `api_secret`, `client_secret` | single ciphertext |
| `organizations` | `settings` → any `enc:`-prefixed value (recursive) | nested secrets |

> If new `EncryptedText` columns or manually-encrypted fields are added later,
> extend `_PLAIN_COLUMNS` (or the JSON handlers) in the script before running.

---

## 2. Critical precondition — run it where the keys live

The script decrypts legacy data, so it **must** run with the **same
`ENCRYPTION_KEY` and `ENCRYPTION_SALT`** the application uses. In practice that
means running it **inside the backend container / environment** where those env
vars are already set — never with a fresh or different key, or it cannot decrypt
existing values.

If `ENCRYPTION_SALT` is unset in the target environment, STOP: the app falls
back to a key derived from `SECRET_KEY`, and running the backfill under a
different effective key than what wrote the data will fail to decrypt it.

---

## 3. Pre-flight checklist (per environment)

- [ ] Deploy the code containing the AES-256-GCM change first, and confirm the
      app is healthy (new writes are already GCM; reads of old data work).
- [ ] Confirm `ENCRYPTION_KEY` / `ENCRYPTION_SALT` in the target env match what
      encrypted the existing data (i.e., unchanged from before).
- [ ] Take a **full database backup** and confirm it restores.
- [ ] Pick a low-traffic window (not required for correctness, but keeps the
      write volume predictable).
- [ ] Run against **staging first**, verify, then production.

---

## 4. Execute

### 4a. Dry run (no writes) — always do this first
```bash
docker exec -it intranet-backend python scripts/reencrypt_to_aesgcm.py
```
Reports, per field group, how many rows were scanned and how many values *would*
be re-encrypted. Example tail:
```
Would re-encrypt 1234 value(s) to AES-256-GCM.
Run again with --commit to apply.
```
If it reports `0`, everything is already AES-256-GCM — you're done.

### 4b. Apply
```bash
docker exec -it intranet-backend python scripts/reencrypt_to_aesgcm.py --commit
```
The run is wrapped in a single transaction per invocation and commits at the end;
on any error it rolls back and exits non-zero (no partial JSON left half-written).

### 4c. Confirm convergence
Re-run the **dry run** (4a). A healthy result is now:
```
Would re-encrypt 0 value(s) to AES-256-GCM.
```
`0` means every covered value is AES-256-GCM.

---

## 5. Post-migration verification

- [ ] Dry-run reports `0` remaining (step 4c).
- [ ] Spot-check application behavior that reads encrypted fields:
  - Log in with an MFA-enabled account (exercises `mfa_secret` +
    `mfa_backup_codes`).
  - Open an org whose email/SSO/storage secrets are configured (Settings →
    email/auth still send / connect; secrets still redacted to `••••••••`).
  - Open a shift completion report with evaluation notes (`areas_*`,
    `officer_narrative`, `reviewer_notes` render).
  - Trigger an integration that uses `integrations.encrypted_config` or an
    external-training provider sync.
- [ ] No new decryption errors in the backend logs (`InvalidTag` /
      `InvalidToken`).

---

## 6. Rollback & safety

- **Interrupted run:** safe. The script is idempotent (skips values that already carry a GCM marker), so
  re-running `--commit` resumes where it left off.
- **Something looks wrong after a commit:** restore from the pre-run backup. There
  is no in-place "downgrade to Fernet" — the forward path is the backup.
- **A value fails to decrypt during the run:** the run rolls back and exits
  non-zero. Investigate before retrying — a decrypt failure under the correct key
  usually means the env's `ENCRYPTION_KEY`/`ENCRYPTION_SALT` does not match what
  wrote the data (see §2), or a row is genuinely corrupt.

---

## 7. Follow-up — retiring Fernet (later, optional)

Once the backfill has run on **all** environments and dry-runs report `0` for a
sustained period (long enough that no un-migrated rows resurface from backups /
restores):

1. Remove the legacy Fernet read branch in `decrypt_data()` and the `_get_cipher`
   / `get_encryption_key()` Fernet helpers in `backend/app/core/security.py`.
2. Keep the `InvalidToken` → legacy-plaintext passthrough only if any plaintext
   rows may still exist; otherwise remove it so undecryptable values fail closed.
3. Run the encryption test suite (`pytest tests/test_auth_security.py`) — the
   legacy-Fernet backward-compat test should be deleted in the same change.

Do **not** do this until you are confident no Fernet-encrypted rows remain in any
environment (including anything that could be restored from an older backup).

---

## 8. Quick reference

```bash
# Dry run (report only)
docker exec -it intranet-backend python scripts/reencrypt_to_aesgcm.py

# Apply
docker exec -it intranet-backend python scripts/reencrypt_to_aesgcm.py --commit
```

- Markers for AES-256-GCM values: `$gcm2$` (current, 600k PBKDF2 iterations) and `$gcm1$` (100k, read-only).
- Related: `backend/app/core/security.py` (`encrypt_data`/`decrypt_data`),
  `docs/KNOWN_LIMITATIONS.md` (crypto row), `CHANGELOG.md`.
