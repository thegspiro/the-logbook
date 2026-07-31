# Backup & Disaster Recovery

How to back up The Logbook, verify that backups actually restore, and recover
from a total loss. Business-continuity alignment context (ISO 22301) lives in
[COMPLIANCE.md](./COMPLIANCE.md).

## What the backup script covers

`scripts/backup.sh` produces a single timestamped archive containing:

| Component | Contents | Notes |
|---|---|---|
| `database.sql` | Full `mysqldump` of the application database | `--single-transaction --quick`, safe against a running server |
| `uploads.tar.gz` | The `uploads/` directory (documents, photos, attachments) | Only if local uploads are used — S3/MinIO-stored files are not included |
| `config/` | `.env.example`, docker-compose files, and a **sanitized** `.env` template | Values are stripped — see the warning below |

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
- `DB_PASSWORD`, `MYSQL_ROOT_PASSWORD`, `REDIS_PASSWORD`

Treat the key copy with the same care as the backups themselves — either one
without the other is incomplete.

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
- [ ] Secrets (`ENCRYPTION_KEY`, `ENCRYPTION_SALT`, `SECRET_KEY`, DB/Redis
      passwords) stored offline in at least two locations
- [ ] Quarterly restore drill scheduled, with results recorded
- [ ] RTO/RPO targets written into department SOPs
