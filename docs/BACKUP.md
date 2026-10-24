# Backup & Disaster Recovery

How to back up The Logbook, verify that backups actually restore, and recover
from a total loss. Business-continuity alignment context (ISO 22301) lives in
[COMPLIANCE.md](./COMPLIANCE.md).

## What the backup script covers

`scripts/backup.sh` produces a single timestamped archive containing:

| Component        | Contents                                                                   | Notes                                                         |
| ---------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `database.sql`   | Full `mysqldump` of the application database                               | `--single-transaction --quick`, safe against a running server |
| `uploads.tar.gz` | Every uploaded file on the uploads volume (documents, photos, attachments) | Not files in a department's own S3 bucket — see below         |
| `config/`        | `.env.example`, `docker-compose.yml`, and a **sanitized** `.env` template  | Values are stripped — see the warning below                   |

Uploads are read from `/app/uploads` inside the running backend container
(`intranet-backend`, or `logbook-backend` on Unraid; set `BACKEND_CONTAINER`
in `.env` for any other name), which reaches the `uploads` volume or the
Unraid appdata bind mount. On a traditional install with no backend container
they are read from `uploads/` in the install directory. If neither exists the
backup still completes, but prints a warning that uploaded files were **not**
backed up — so run the script while the stack is up. A restore writes the
files back to the same place.

Destinations: local disk (default `./backups`), S3, Azure Blob, or Google
Cloud Storage via `--destination`. Old local backups are pruned after
`BACKUP_RETENTION_DAYS` (default 30).

```bash
./scripts/backup.sh                    # local backup
./scripts/backup.sh --destination s3   # push to S3 (uses AWS_* env vars)
./scripts/backup.sh --list             # list available backups
./scripts/backup.sh --restore FILE     # restore a backup
```

Schedule it (02:00 daily shown; align frequency with your RPO, below):

```cron
0 2 * * * /path/to/the-logbook/scripts/backup.sh
```

## Encrypted backups

Every backup holds every member's records and uploaded files. Since
2026-10-23 they are encrypted before they reach the backups directory, once a
key exists. Until you create one, backups keep running **unencrypted**, every
run logs a warning, and administrators see a "Backups are not encrypted"
notice.

### Set it up (once)

On the host, in the install directory:

```bash
./scripts/backup-keygen.sh
```

It writes two things to `backup-keys/` (on Unraid,
`/mnt/user/appdata/the-logbook/backup-keys`) and mounts them read-only into the
backup container:

| File                   | Where it lives                                | What it does                                                                                                                                                                                |
| ---------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `backup-drill.key`     | The server, and a copy you store elsewhere    | Lets the nightly restore drill open the archive it just wrote. Anyone who controls the server can read backups with it.                                                                     |
| `backup-recipient.pem` | The server (it is the **public** certificate) | Every archive is also encrypted to this. Its **private key** is printed once and never stored on the server: put it in a password manager or a safe, apart from the server and its backups. |

The private key is what protects backups taken **before** a server
compromise, and the only way back if the drill key is lost. **If both are
lost, every encrypted backup is unrecoverable.** The script asks you to type
`SAVED` before it keeps anything.

Options: `--import-certificate FILE` to use a certificate whose private key
you made elsewhere (recommended if you have an offline machine);
`--private-key-out FILE` to write the private key to a path outside
`backup-keys/` instead of printing it; `--drill-key-only` for no certificate
(not recommended); `--force` to replace keys (archives made with the old keys
need the old keys).

### What a backup looks like

Each backup is three files that must stay together:

```
logbook_backup_YYYYmmdd_HHMMSS.tar.gz.enc         the archive, AES-256
logbook_backup_YYYYmmdd_HHMMSS.tar.gz.enc.key     the wrapped archive key
logbook_backup_YYYYmmdd_HHMMSS.tar.gz.enc.sha256  checksum of the .enc
```

The `.enc.key` file is a small envelope holding that archive's random key and
the SHA-256 of the `.enc`, encrypted to the certificate and the drill key.
Either opens it. A corrupted, truncated or swapped `.enc` is refused before
anything is decrypted. This detects damage; it does not prove who wrote the
archive, because anyone holding the public certificate can build a valid pair.

The plaintext archive is assembled in a temporary directory and never written
to the backups directory once a key exists.

### Existing plaintext backups

The first backup after you create a key also converts the plaintext archives
already in the backups directory. Each is encrypted, decrypted again with the
drill key, compared byte for byte with the original, and only then removed
(with its old checksum). Without a drill key nothing is deleted. Turn the
conversion off with `BACKUP_ENCRYPT_EXISTING=false`, or run it by hand with
`./scripts/backup.sh --encrypt-existing`.

### Restoring and verifying an encrypted backup

```bash
# With the drill key still in backup-keys/ (the usual case):
./scripts/backup.sh --restore backups/logbook_backup_X.tar.gz.enc

# After losing the server: restore the certificate into backup-keys/, then
./scripts/backup.sh --restore X.tar.gz.enc --private-key /path/to/private.pem
./scripts/backup.sh --restore X.tar.gz.enc --drill-key /path/to/backup-drill.key

# Prove an archive restores without touching production:
./scripts/verify_backup.sh X.tar.gz.enc --private-key /path/to/private.pem
```

Plaintext archives restore as before.

### Offsite copies

`./scripts/backup.sh --destination s3|azure|gcs` uploads the `.enc`, `.enc.key`
and `.sha256` files and **refuses to upload an unencrypted archive**. If you
sync the backups directory with your own tooling, sync all three files.

## Files in a department's own S3 bucket

A department that switched its storage to its own S3 or MinIO bucket
(Organization Settings > Storage, "Test and switch to S3") keeps its files
**there, not on the uploads volume**, so `uploads.tar.gz` does not contain
them. The backup does not download buckets (owner decision, 2026-10-22): that
would put every department's bucket credentials on the backup host and make
each backup as large as every bucket. Back a bucket up with its provider's own
tooling instead:

- **AWS S3:** turn on bucket versioning, so an overwritten or deleted object
  can be recovered, and Cross-Region (or Same-Region) Replication, so a copy
  survives losing the bucket or its account access. AWS Backup can also take
  scheduled S3 backups.
- **MinIO:** `mc mirror --overwrite <alias>/<bucket> <destination>` on a
  schedule, or site replication to a second MinIO.
- **Other S3-compatible stores:** their own versioning and replication, or
  `rclone sync` to a second store.

Objects are encrypted before upload with the installation's file key (see the
secrets section below), so a bucket copy is as unreadable without
`ENCRYPTION_KEY` / `ENCRYPTION_SALT` as the uploads archive, and a restored
copy needs the keys that were current when it was written.

When the backend container is running, `scripts/backup.sh` asks it which
departments keep files in which bucket and prints them under a warning, so a
backup run says what it left out. To check by hand:

```bash
docker exec -it intranet-backend python scripts/migrate_uploads_to_s3.py --buckets
```

A restore drill for such a department also opens a recently uploaded file
from its bucket. That checks the bucket is reachable and the keys are right.

## Automated: the backup sidecar (production compose)

Production deployments don't need the host cron: `docker-compose.prod.yml`
includes a `backup` service (`scripts/backup-sidecar.sh`) that runs nightly
at `BACKUP_TIME` (default 02:00 UTC), writing restore-compatible archives of
the database, uploads, and audit archives to the `backups` volume, pruning
after `BACKUP_RETENTION_DAYS`.

**It also drills itself:** every `VERIFY_EVERY_N_BACKUPS` runs (default 7),
`scripts/verify_backup.sh` decrypts the archive with the drill key, loads the
fresh dump into a throwaway schema on
the MySQL server, asserts the core tables and full schema came back, and
drops it. A failed drill screams in the service logs on every subsequent
nightly run until fixed — watch `docker compose logs backup`.

The `backups` volume is still on the same host. **Sync it offsite** (S3,
rsync target, NAS) — that step, plus offline key custody, is what makes it
a recovery plan. You can also run a drill by hand against any archive:

```bash
docker compose exec backup bash /scripts/verify_backup.sh \
  /backups/logbook_backup_YYYYmmdd_HHMMSS.tar.gz.enc
```

## ⚠️ Secrets are NOT in the backup — store them separately

The backup deliberately excludes the real `.env` (only a values-stripped
template is included), so a leaked backup archive does not leak your
credentials. The flip side: **a backup alone cannot bring the system back.**
You must keep an offline, secure copy (password manager, sealed envelope in a
safe, vault) of at minimum:

- `SECRET_KEY` — without it, all sessions/tokens are invalidated (tolerable)
- `ENCRYPTION_KEY` + `ENCRYPTION_SALT` — **without these, every encrypted
  field in the database backup (MFA secrets, medical evaluation narratives,
  integration credentials) is permanently unrecoverable.** There is no reset.
  Restoring with a different `ENCRYPTION_SALT` also leaves every registered
  NFC tag and ID card unmatched — their UIDs are stored only as salted
  hashes — so each would have to be registered again.
- `DB_PASSWORD`, `MYSQL_ROOT_PASSWORD`, `REDIS_PASSWORD`

Treat the key copy with the same care as the backups themselves — either one
without the other is incomplete. The same goes for the backup keys above
(`backup-drill.key` and the certificate's private key).

**Since 2026-10-09 the uploads are encrypted too.** Every file under
`uploads/` is encrypted with a key derived from `ENCRYPTION_KEY` and
`ENCRYPTION_SALT`, so an `uploads.tar.gz` without them is noise, and an
`uploads.tar.gz` stored with them is as readable as if it were plaintext.
**Never keep the key copy in the same place as the backups.** Setup asks an
administrator to confirm this, and an existing installation shows a notice
until somebody does (`docs/FILE_STORAGE_HARDENING.md`, decision 25).
Archives made before `scripts/encrypt_uploads.py` was run still hold the
files in plaintext (see `docs/KNOWN_LIMITATIONS.md`).

## Audit-log archives

The weekly audit job (`audit_log_archival`) enforces
`HIPAA_AUDIT_RETENTION_DAYS` (default 7 years) by exporting expired audit
rows to gzipped JSONL files in `AUDIT_ARCHIVE_DIR` (default
`./audit_archives`) before purging them from the database. **After a purge,
those files are the only copy of the oldest audit history** — include the
directory in your backup destination alongside `uploads/`.

## What is intentionally not backed up

- **Redis** — sessions, rate-limit counters, and cache are ephemeral; users
  simply log in again after a restore.
- **TLS certificates** — reissue via Let's Encrypt (`scripts/setup-ssl.sh`).
- **Container images** — rebuilt from the compose files in the backup.

## Verify your backups (restore drill)

A backup that has never been restored is a hope, not a recovery plan. Run a
restore drill **at least quarterly**:

1. Provision a scratch host (or a VM) with Docker.
2. Copy the latest backup archive and your securely stored `.env` secrets.
3. Bring up a fresh stack: `docker compose up -d` with the restored `.env`.
4. Restore: `./scripts/backup.sh --restore <archive>`.
5. Verify, at minimum:
   - Log in with an admin account (proves DB + `SECRET_KEY`).
   - Open a page that renders encrypted data — e.g. an MFA-enabled user's
     security settings or a medical-screening record (proves
     `ENCRYPTION_KEY`/`ENCRYPTION_SALT` are the right ones).
   - Open a recently uploaded document (proves the uploads archive).
   - Check audit-log integrity: `GET /api/v1/security/audit-log/integrity`
     (proves the hash chain survived the dump/restore).
6. Record the drill date, archive tested, and time-to-restore in your
   department's records. That duration is your measured RTO.

## Recovery objectives (RTO / RPO)

Set these deliberately and write them down; auditors and insurers ask.

- **RPO (max acceptable data loss)** = your backup interval. The default
  nightly cron gives RPO ≈ 24h. If a day of lost check-ins, training records,
  or form submissions is unacceptable, run the script more often.
- **RTO (max acceptable downtime)** = your measured restore-drill time plus
  host-provisioning time. For a single-node Docker deployment, a practiced
  restore is typically under an hour once hardware is available.

Suggested starting targets for a volunteer department: **RPO 24h, RTO 4h.**
Tighten them if the platform is used during activations.

## Disaster-recovery runbook (total host loss)

1. Provision a replacement host (see `docs/deployment/` for per-platform
   guides) and install Docker.
2. Clone the repository at the version you were running (the backup's
   `config/` folder records your compose files).
3. Recreate `.env` from your securely stored secrets copy.
4. Fetch the newest backup archive from your offsite destination
   (S3/Azure/GCS — this is why a cloud destination matters; a backup on the
   dead host's disk is gone with it).
5. `docker compose up -d`, wait for healthchecks, then
   `./scripts/backup.sh --restore <archive>`.
6. Run the verification steps from the restore drill above.
7. Re-point DNS / reverse proxy at the new host; reissue TLS certificates.

## Operational checklist

- [ ] Nightly cron installed and writing to an **offsite** destination
- [ ] `BACKUP_RETENTION_DAYS` set to your retention policy (≥30 recommended)
- [ ] Backup keys created (`scripts/backup-keygen.sh`), the private key and a
      copy of `backup-drill.key` stored away from the server
- [ ] Secrets (`ENCRYPTION_KEY`, `ENCRYPTION_SALT`, `SECRET_KEY`, DB/Redis
      passwords) stored offline in at least two locations
- [ ] Every department's own S3 bucket (`migrate_uploads_to_s3.py --buckets`)
      versioned and replicated or mirrored with its provider's tooling
- [ ] Quarterly restore drill scheduled, with results recorded
- [ ] RTO/RPO targets written into department SOPs

## Audit archive filesystem permissions (August 14, 2026)

New audit archive directories are created as owner-only (`0700`) and archive
files as owner read/write (`0600`). Creation uses an exclusive descriptor, so
there is no interval in which a newly written archive is world-readable. This
protects exported audit payloads independently of the surrounding deployment's
umask.

This is forward-looking: the application does not silently chmod historical
archives. During upgrade, inspect the configured archive path and repair older
files/directories according to department ownership and retention policy. Do
not broaden permissions merely to make a backup sidecar work; grant that process
access through the owning account/group and test restore separately.
