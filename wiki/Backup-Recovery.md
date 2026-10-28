# Backup & Disaster Recovery

What to back up, how backups run, how to restore one, and how to prove they
restore before the day you need them.

> The full reference is [docs/BACKUP.md](https://github.com/thegspiro/the-logbook/blob/main/docs/BACKUP.md).

> ⚠️ **A backup alone cannot bring the system back.** The database and the
> uploaded files are encrypted with `ENCRYPTION_KEY` and `ENCRYPTION_SALT`,
> which are deliberately **not** in the backup. Lose them and every backup you
> hold is unreadable — there is no reset.

---

## What has to be protected

| Item                                                         | Where it lives                                                                                      | Covered by the backup?                             |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| Database                                                     | The MySQL container                                                                                 | Yes — a `mysqldump`, safe against a running server |
| Uploaded files                                               | `/app/uploads` in the backend (`uploads` volume; on Unraid `/mnt/user/appdata/the-logbook/uploads`) | Yes                                                |
| Audit-log archives                                           | `AUDIT_ARCHIVE_DIR` (the `audit_archives` volume under the production compose)                      | Only by the production sidecar — see below         |
| Files in a department's own S3 bucket or Google Shared Drive | The department's store                                                                              | **No** — back these up with the provider's tooling |
| `.env` secrets                                               | `.env` on the host                                                                                  | **No** — only a values-stripped template           |
| Backup encryption keys                                       | `backup-keys/` and your offline copy                                                                | **No**                                             |

Not backed up, on purpose: **Redis** (sessions and cache — members sign in
again), **TLS certificates** (reissue them; `scripts/setup-ssl.sh` sets up
Let's Encrypt), **container images** (rebuilt from the compose files).

### The secrets, and why two of them are fatal

Keep an offline copy — password manager, sealed envelope in a safe — in at
least two places, **never beside the backups**:

| Secret                                                 | Lose it and…                                                                                                                                                                                                                                                 |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `ENCRYPTION_KEY`                                       | Every encrypted field (MFA secrets, medical screening, home addresses and phones, dates of birth, integration credentials) and every stored file is permanently unreadable                                                                                   |
| `ENCRYPTION_SALT`                                      | The same — the key is derived with it. Every registered NFC tag and ID card also stops matching (their UIDs are stored only as salted hashes) and must be registered again                                                                                   |
| `SECRET_KEY`                                           | Everyone is signed out — tolerable. Audit rows and ballots signed with it before a dedicated key existed read as tampered, and a department's own bucket or drive must pass its connection test again — see [Key Rotation](Security-Key-Rotation#secret_key) |
| `AUDIT_LOG_SIGNING_KEY`, `VOTE_SIGNING_KEY`            | Historical audit rows or ballots signed with them can no longer be verified                                                                                                                                                                                  |
| `DB_PASSWORD`, `MYSQL_ROOT_PASSWORD`, `REDIS_PASSWORD` | Recoverable, but needed to bring a rebuilt stack up quickly                                                                                                                                                                                                  |

Keep **retired** encryption keys too, labelled with the dates of the backups
they open: an old backup needs the key that was current when it was written.
See [Key Rotation](Security-Key-Rotation).

---

## How backups run

|               | Backup sidecar                                                          | `scripts/backup.sh`                            |
| ------------- | ----------------------------------------------------------------------- | ---------------------------------------------- |
| Runs          | Automatically, nightly at `BACKUP_TIME` (default `02:00`)               | When you run it, or from cron on the host      |
| Where         | `backup` service in `docker-compose.prod.yml` and in the Unraid compose | On the host, from the install directory        |
| Writes to     | The `backups` volume; on Unraid `/mnt/user/backups/the-logbook`         | `./backups`, or `BACKUP_LOCATION`              |
| Contents      | Database, uploads, and (production compose only) audit archives         | Database, uploads, a sanitized config template |
| Restore drill | Every `VERIFY_EVERY_N_BACKUPS` runs (default `7`; `0` disables)         | Run one by hand                                |
| Prunes after  | `BACKUP_RETENTION_DAYS` (default `30`)                                  | `BACKUP_RETENTION_DAYS`                        |

`BACKUP_TIME` is the container's clock: **UTC** under the production compose,
the `TZ` setting (default `America/New_York`) on Unraid. There is no on/off
switch — the sidecar backs up whenever it runs. With the external-services
override the sidecar does not run; use the database provider's backups and copy
the uploads and audit archives yourself.

> **Audit archives.** After the weekly `audit_log_archival` job purges rows older
> than `HIPAA_AUDIT_RETENTION_DAYS` (default 2555 days), the gzipped JSONL files
> in `AUDIT_ARCHIVE_DIR` are the **only** copy of that history. The production
> sidecar includes them; `scripts/backup.sh` does not. On Unraid the default
> `AUDIT_ARCHIVE_DIR` is inside the backend container and not on one of its
> mounts, so copy those files somewhere durable yourself.

Watch the sidecar: a failed backup or drill is logged loudly on every run until
fixed.

```bash
docker compose logs backup
```

---

## Turn on backup encryption (once)

Until a key exists, backups are written **unencrypted**, every run logs a
warning, and administrators see a "Backups are not encrypted" notice. On the
host, in the install directory:

```bash
./scripts/backup-keygen.sh
```

It writes two files to `backup-keys/` (on Unraid,
`/mnt/user/appdata/the-logbook/backup-keys`), which the sidecar mounts
read-only:

| File                   | Purpose                                                                                                                       |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `backup-drill.key`     | Lets the restore drill open what it wrote. Anyone who controls the server can read backups with it. Keep a copy elsewhere too |
| `backup-recipient.pem` | The public certificate every archive is also encrypted to. Its **private key is printed once and never stored on the server** |

Put the private key in a password manager or safe, apart from the server and
its backups. It is the only thing that protects backups taken before a server
compromise, and the only way in if the drill key is lost. **If both are lost,
every encrypted backup is unrecoverable.** The script will not keep the keys
until you type `SAVED`.

| Option                      | Use                                                                             |
| --------------------------- | ------------------------------------------------------------------------------- |
| `--import-certificate FILE` | Use a certificate whose private key you generated on an offline machine         |
| `--private-key-out FILE`    | Write the private key to a file (outside `backup-keys/`) instead of printing it |
| `--drill-key-only`          | No certificate — not recommended                                                |
| `--force`                   | Replace existing keys; older archives still need the old keys                   |

From then on each backup is three files that must stay together:

```
logbook_backup_YYYYmmdd_HHMMSS.tar.gz.enc         the archive
logbook_backup_YYYYmmdd_HHMMSS.tar.gz.enc.key     its key, wrapped to the certificate and the drill key
logbook_backup_YYYYmmdd_HHMMSS.tar.gz.enc.sha256  checksum
```

The next run also encrypts the plaintext archives already in the backups
directory, removing each only after it decrypts back identical. Set
`BACKUP_ENCRYPT_EXISTING=false` to skip that, or run it by hand with
`./scripts/backup.sh --encrypt-existing`.

---

## Manual backups and offsite copies

```bash
./scripts/backup.sh                     # local backup
./scripts/backup.sh --destination s3    # also upload: s3, azure or gcs
./scripts/backup.sh --list              # list backups, marked encrypted or PLAINTEXT
```

Run it while the stack is up: it dumps the database through the running
`intranet-mysql` / `logbook-db` container and reads uploads from the running
`intranet-backend` / `logbook-backend` container (set `DB_CONTAINER` or
`BACKEND_CONTAINER` in `.env` for other names). With no backend running it
still finishes, but warns that uploads were **not** backed up.

Offsite uploads need the provider's CLI on the host (`aws`, `az` or `gsutil`)
and `AWS_S3_BUCKET`, `AZURE_STORAGE_ACCOUNT` + `AZURE_STORAGE_CONTAINER`, or
`GCS_BUCKET` in `.env`. They copy all three files and **refuse to upload an
unencrypted archive**. If you sync the backups directory with your own tooling
instead, sync all three files.

Daily from cron, aligned with your RPO:

```cron
0 2 * * * /path/to/the-logbook/scripts/backup.sh
```

### Departments that keep files in their own store

A department that switched to its own S3/MinIO bucket or Google Shared Drive
keeps those files there, and the backup does not download them. Each run lists
which departments are affected; to check by hand:

```bash
docker exec -it intranet-backend python scripts/migrate_uploads_to_remote.py --stores
```

- **S3:** turn on versioning and replication; AWS Backup can also schedule S3
  backups.
- **MinIO:** `mc mirror --overwrite <alias>/<bucket> <destination>` on a
  schedule, or site replication.
- **Shared Drive:** a deleted file stays in the drive's trash for 30 days and a
  drive Manager can restore it **with its id intact** — the quick recovery, so
  do not empty the trash by hand. A copy taken elsewhere (for example with
  rclone and a separate read-only service account) gets new file ids, so it
  cannot simply be put back; it is the copy of last resort.

These files are encrypted with the installation's file key, so a copy needs
`ENCRYPTION_KEY` and `ENCRYPTION_SALT` just like the uploads archive.

---

## Restore

```bash
# Plaintext archive, or encrypted with the drill key still in backup-keys/
./scripts/backup.sh --restore backups/logbook_backup_YYYYmmdd_HHMMSS.tar.gz.enc

# After losing the server: put backup-recipient.pem back in backup-keys/, then
./scripts/backup.sh --restore FILE.tar.gz.enc --private-key /path/to/private.pem
# or, with your copy of the drill key
./scripts/backup.sh --restore FILE.tar.gz.enc --drill-key /path/to/backup-drill.key
```

It asks you to type `yes`, checks the checksum, decrypts (refusing a damaged or
mismatched archive before anything is written), then loads the database and
writes the uploads back to where it would have read them. **It overwrites the
current data.** Restore into a running stack whose `.env` holds the secrets
that were current when the backup was taken.

An archive written by the production sidecar also contains
`audit_archives.tar.gz`; `backup.sh --restore` does not put it back, so extract
it into the audit archive volume yourself if you need that history.

---

## Prove it restores

### Automatic drills

The sidecar decrypts the newest archive with the drill key, loads the dump into
a throwaway schema, checks the core tables came back, and drops the schema. To
drill any archive by hand:

```bash
docker compose exec backup bash /scripts/verify_backup.sh \
  /backups/logbook_backup_YYYYmmdd_HHMMSS.tar.gz.enc
```

### Quarterly restore drill

A backup that has never been restored is a hope, not a plan.

1. Provision a scratch host or VM with Docker.
2. Copy the latest archive (all three files) and your stored secrets.
3. Bring up a fresh stack with the restored `.env`: `docker compose up -d`.
4. `./scripts/backup.sh --restore <archive>` (with `--private-key` if the
   drill key is not on the scratch host).
5. Check:
   - an administrator can sign in (database and `SECRET_KEY`);
   - an MFA-enabled member's security settings or a medical-screening record
     opens (the right `ENCRYPTION_KEY` and `ENCRYPTION_SALT`);
   - a recently uploaded document opens (the uploads archive), and for a
     department on its own bucket or drive, a recent file from there;
   - the audit chain is intact: `GET /api/v1/security/audit-log/integrity`
     (needs `audit.view`).
6. Record the date, the archive tested and the time it took. That time is your
   measured RTO.

---

## RTO and RPO

Write both down; auditors and insurers ask.

- **RPO** (data you can afford to lose) is your backup interval. Nightly gives
  about 24 hours; run more often if a day of check-ins and training records is
  too much.
- **RTO** (downtime you can afford) is your measured drill time plus the time
  to get a host. A practised single-node restore is typically under an hour
  once hardware is available.

A reasonable starting point for a volunteer department: **RPO 24h, RTO 4h** —
tighter if the platform is used during activations.

## Total host loss

1. Provision a replacement host and install Docker
   ([Docker](Deployment-Docker), [Unraid](Deployment-Unraid)).
2. Clone the repository at the version you were running.
3. Recreate `.env` from your stored secrets.
4. Fetch the newest archive from offsite — a backup on the dead host's disk
   died with it.
5. `docker compose up -d`, wait for healthchecks, then restore as above.
6. Run the drill checks.
7. Point DNS or the reverse proxy at the new host and reissue TLS certificates.

---

## Checklist

- [ ] Backups land **offsite** every night
- [ ] `BACKUP_RETENTION_DAYS` set to your retention policy (30 or more)
- [ ] `./scripts/backup-keygen.sh` run; private key and a copy of
      `backup-drill.key` stored away from the server
- [ ] `ENCRYPTION_KEY`, `ENCRYPTION_SALT`, `SECRET_KEY` and the passwords stored
      offline in two places, apart from the backups
- [ ] Audit archives included in what you copy offsite
- [ ] Every department bucket or Shared Drive protected with its provider's
      tooling
- [ ] Quarterly restore drill scheduled and recorded
- [ ] RTO and RPO written into department SOPs

## Related

- [Key Rotation](Security-Key-Rotation)
- [Encryption](Security-Encryption)
- [Production Deployment](Deployment-Production)
- [Unraid Deployment](Deployment-Unraid)
- [Compliance Hub](Compliance-Hub)
- [Troubleshooting → Backup & Restore](Troubleshooting#backup--restore)
