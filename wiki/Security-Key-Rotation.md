# Key Rotation

How to replace the installation's keys, and what each replacement costs.
`ENCRYPTION_KEY` can be rotated with no downtime and no data loss;
`ENCRYPTION_SALT` must never change; the signing keys have consequences that
are easy to miss.

> The full reference is [docs/KEY_ROTATION.md](https://github.com/thegspiro/the-logbook/blob/main/docs/KEY_ROTATION.md).

---

## Before you start

- **Take a backup and copy your current `.env`** — see
  [Backup & Recovery](Backup-Recovery).
- **Apply `.env` changes with `docker compose up -d`, not `docker compose
restart`.** The backend's settings are passed in when its container is
  created; `restart` reuses the old container and the old values, while `up -d`
  recreates any service whose configuration changed.
- The commands below use the compose service name `backend`, which is the same
  on the standard and Unraid stacks. `docker exec -it intranet-backend …` (or
  `logbook-backend` on Unraid) is equivalent.

## What each key does

| Key                     | Protects                                                                    | Rotate?                              | Consequence                                                                                                      |
| ----------------------- | --------------------------------------------------------------------------- | ------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| `ENCRYPTION_KEY`        | Encrypted database fields and every stored file                             | **Yes**, with the procedure below    | None, if the old key stays in `ENCRYPTION_KEYS_LEGACY` until the drain finishes                                  |
| `ENCRYPTION_SALT`       | Part of the derivation of every key in the ring; NFC tag and ID card hashes | **Never**                            | Every encrypted value becomes unreadable under every key, and every NFC tag and ID card must be registered again |
| `SECRET_KEY`            | Sign-in tokens and other short-lived signed links                           | Yes, any time                        | Everyone signed out, and more — see [`SECRET_KEY`](#secret_key)                                                  |
| `AUDIT_LOG_SIGNING_KEY` | The audit log's tamper-evident hash chain                                   | **Not casually**                     | Historical audit rows verify only under the key that wrote them                                                  |
| `VOTE_SIGNING_KEY`      | Ballot signatures                                                           | **Not casually**                     | Existing ballots verify only under the key that signed them                                                      |
| Backup keys             | Encrypted backup archives                                                   | `./scripts/backup-keygen.sh --force` | Archives made earlier still need the old keys — keep them                                                        |

## When to rotate `ENCRYPTION_KEY`

- The key may have been exposed: a leaked copy of `.env`, an administrator who
  held it has left, or it was committed somewhere by mistake.
- On the department's own schedule. Annual is a reasonable default, and ISO
  27001 auditors ask for a defined cadence.

## How rotation stays safe

Decryption uses a **key ring**: the current `ENCRYPTION_KEY` first, then each
key in `ENCRYPTION_KEYS_LEGACY` (comma-separated). Encryption always uses the
current key. Because AES-GCM authenticates every value, only the right key can
ever decrypt it — trying several never weakens the fail-closed behaviour.

So every intermediate state is safe: the moment the new key is deployed with
the old one in the legacy list, everything still reads and every new write
already uses the new key. The rest of the procedure only moves old data
across so the old key can be retired.

New values are derived at 600,000 PBKDF2 iterations (marked `$gcm2$`); values
written before 2026-08-01 carry `$gcm1$` and 100,000. Both stay readable, and
the drain below rewrites older values at the new work factor as it goes — no
separate migration is needed.

---

## Rotating `ENCRYPTION_KEY`

**1. Back up** the database and your current `.env`.

**2. Generate a new key:**

```bash
python3 -c "import secrets; print(secrets.token_hex(32))"
```

**3. Edit `.env`.** Move the old key into the legacy list and set the new one:

```bash
ENCRYPTION_KEYS_LEGACY=<the old ENCRYPTION_KEY>   # append, comma-separated, if one is already there
ENCRYPTION_KEY=<the new key>
```

Leave `ENCRYPTION_SALT` exactly as it is. It belongs to the installation, not
to a key, and key rotation never needs it to change.

**4. Apply and check:**

```bash
docker compose up -d
```

Sign in with an account that uses MFA. Its secret is encrypted, so a
successful sign-in proves the ring is reading old values.

**5. Drain the database fields** — a report first, then the rewrite:

```bash
docker compose exec backend python scripts/rotate_encryption_key.py
docker compose exec backend python scripts/rotate_encryption_key.py --commit
```

The script prints how many values were already under the current key, how
many it rotated, and how many were **unreadable with any key**. It never
deletes or overwrites a value it cannot read. Run `--commit` again until it
reports zero rotated and zero unreadable and prints "Rotation drained".

**6. Move stored files to the new key.** On the uploads volume this rewraps
each file's own key, not its contents, so it is quick. Files in a department's
own S3 bucket or Google Shared Drive are downloaded, re-encrypted and uploaded
again, which takes as long as the transfer:

```bash
docker compose exec backend python scripts/encrypt_uploads.py --rewrap
docker compose exec backend python scripts/encrypt_uploads.py --rewrap --apply
```

The report is JSON with the uploads volume and the remote stores listed
separately. Run the report again afterwards: `under_a_retired_key` (uploads
volume) and `bucket_objects_under_a_retired_key` (remote stores) should both
be zero.

**7. Confirm key custody.** Administrators see "Confirm the encryption key is
stored somewhere safe" again, because the new key has a new fingerprint. Store
the new key offline, then confirm it.

**8. Retire the old key.** Once both drains are clean, remove the drained key
from `ENCRYPTION_KEYS_LEGACY` and run `docker compose up -d`.

**9. Update the offline copies.** An old backup restored later needs the key
that was current when it was written, so keep retired keys where you keep the
current one, labelled with the dates of the backups they open — and never with
the backups themselves.

### If something goes wrong

| Symptom                                        | Cause and fix                                                                                                                                                       |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `unreadable with any key` in the script output | Some values were written under a key that is not in the ring. Add that old key to `ENCRYPTION_KEYS_LEGACY`, apply, and re-run. Nothing was changed for those values |
| MFA sign-in fails after step 4                 | The legacy list is missing the old key or has a typo. Put the previous `.env` values back and apply — nothing has been rewritten yet                                |
| `--rewrap` exits non-zero                      | A file failed, or a department's bucket or drive could not be reached. Fix access and run it again; it only touches what is still under a retired key               |

---

## `SECRET_KEY`

`SECRET_KEY` signs sign-in tokens, so rotating it **signs everyone out** by
design. Do it separately from an `ENCRYPTION_KEY` rotation, and expect:

- **Every member signs in again.**
- **Links in flight stop working**: a half-finished calendar or Salesforce
  connection has to be started again, and a guest check-in confirmation issued
  before the change is refused.
- **Departments on their own S3 bucket or Google Shared Drive** fall back to
  writing new files to this server's disk. The saved connection is fingerprinted
  with `SECRET_KEY`, so after a rotation it reads as changed since its last
  test. Existing files are still read from the bucket or drive; an
  administrator restores normal operation by running **Test and switch** again
  in the storage settings.
- **Audit rows and ballots signed with `SECRET_KEY`** read as tampered. That is
  every one of them if `AUDIT_LOG_SIGNING_KEY` / `VOTE_SIGNING_KEY` were never
  set, and the older rows if they were set later. Set both dedicated keys, and
  let them sign for a while, before you ever need to rotate `SECRET_KEY`.

To rotate it:

```bash
python3 -c "import secrets; print(secrets.token_urlsafe(64))"
```

Put the result in `SECRET_KEY`, then `docker compose up -d`.

## `AUDIT_LOG_SIGNING_KEY` and `VOTE_SIGNING_KEY`

Both key an HMAC over records that must stay verifiable for years — audit
history and ballots — and each record verifies only under the key that signed
it. **Do not rotate them on a schedule**, and do not change one to "tidy up":
every record signed under the old value would then fail verification. There
is no re-signing tool — the audit-chain rehash repairs only rows written before
the chain was keyed and refuses to rewrite a keyed row — so a suspected
compromise of either key is a matter for your incident-response policy, not a
routine rotation.

Generate them, once, the same way as `SECRET_KEY`, and store them offline with
your other secrets.

---

## Related

- [Encryption](Security-Encryption)
- [Backup & Recovery](Backup-Recovery)
- [Audit Logging](Security-Audit-Logging)
- [Configuration — Security](Configuration-Security)
- [Compliance Hub](Compliance-Hub)
