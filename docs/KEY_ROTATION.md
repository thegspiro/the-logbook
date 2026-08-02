# Encryption Key Rotation

How to rotate `ENCRYPTION_KEY` — the key protecting at-rest encrypted fields
(MFA secrets and backup codes, integration credentials, shift-evaluation
narratives, `enc:`-prefixed secrets in organization settings) — without any
downtime or data loss.

Rotate when: the key may have been exposed (leaked backup of `.env`, offboarded
administrator who held it, secret accidentally committed), or on your
department's scheduled cadence (annual is a reasonable default; ISO 27001
auditors ask for a defined one).

## How it works

Decryption uses a **key ring**: the current `ENCRYPTION_KEY` is tried first,
then each entry in `ENCRYPTION_KEYS_LEGACY` (comma-separated previous keys).
Encryption always uses the current key. AES-GCM authentication means only the
correct key can ever successfully decrypt a value — trying multiple keys never
weakens the fail-closed behavior.

So a rotation is safe at every intermediate step: the moment you deploy the
new key with the old one in the legacy list, everything still reads, and all
new writes already use the new key.

### Key-derivation work factor *(2026-08-01)*

The key is derived from `ENCRYPTION_KEY` with PBKDF2-HMAC-SHA256. New writes
use **600,000 iterations** and carry a `$gcm2$` marker; values written before
that carry `$gcm1$` and are derived at the previous **100,000**.

Both counts are permanent. The iteration count is part of a value's identity —
change it and the derived key changes — so raising it without keeping the old
one would have made every previously encrypted field unreadable. Decryption
picks the count from the value's own marker, and the legacy key ring works at
either.

The drain step below rewrites `$gcm1$` values at the new factor as a side
effect: `decrypts_with_current_key()` reports them as needing a rewrite, so no
separate migration is required.

Scope, stated honestly: iteration count defends a *low-entropy* input. A
properly generated `ENCRYPTION_KEY` (64 hex characters) is not brute-forceable
at any count. This is defense in depth for installations that set a weak key
or fall back to the `SECRET_KEY`-derived salt, plus alignment with OWASP's
current recommendation, which auditors do check.

## Procedure

1. **Back up first** — database and your current `.env` secrets
   (see [BACKUP.md](./BACKUP.md)).
2. Generate a new key:
   ```bash
   python3 -c "import secrets; print(secrets.token_hex(32))"
   ```
3. Edit `.env`:
   ```bash
   ENCRYPTION_KEYS_LEGACY=<old ENCRYPTION_KEY value>   # append if rotating again
   ENCRYPTION_KEY=<new value>
   ```
   Do **not** change `ENCRYPTION_SALT` — it is installation-scoped, not
   key-scoped, and changing it invalidates every key in the ring.
4. Restart the stack. Verify sign-in with an MFA-enabled account (proves the
   ring reads old ciphertext).
5. Drain: re-encrypt everything under the new key.
   ```bash
   # Report only:
   docker exec -it intranet-backend python scripts/rotate_encryption_key.py
   # Apply:
   docker exec -it intranet-backend python scripts/rotate_encryption_key.py --commit
   ```
6. When the script reports zero rotated and zero unreadable values on a
   `--commit` run, remove the drained key from `ENCRYPTION_KEYS_LEGACY` and
   restart.
7. Update the offline copies of your secrets (see BACKUP.md) — an old backup
   restored later will need whichever key encrypted it, so keep retired keys
   with the backups from their era, clearly labeled.

## Troubleshooting

- **`unreadable with any key` in the script output** — some values were
  written under a key not present in the ring. Add the missing old key to
  `ENCRYPTION_KEYS_LEGACY` and re-run. The script never deletes or overwrites
  values it cannot read.
- **MFA login fails after step 4** — the legacy list is missing or has a typo
  in the old key. Restore the previous `.env` values; nothing was rewritten
  yet.

## Scope notes

- This rotates the **data-encryption key** only. `SECRET_KEY` (JWT signing)
  rotation invalidates active sessions/tokens by design — do it separately
  and expect users to sign in again. `AUDIT_LOG_SIGNING_KEY` must NOT be
  casually rotated: historical audit rows verify under the key that wrote
  them (use the documented rehash procedure if it is ever compromised).
