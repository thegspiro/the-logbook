# Backup and Continuity Policy — Skeleton

Operational reference: [../BACKUP.md](../BACKUP.md) (what the backup
covers, restore drill steps, DR runbook). This policy records the
department's commitments; that document explains how to execute them.

## Commitments

- **Backups:** nightly automated backups to an offsite destination
  [DEPARTMENT: S3/Azure/GCS bucket + region], retained
  [DEPARTMENT: ≥30] days.
- **Secrets escrow:** encryption keys and service credentials stored
  offline in [DEPARTMENT: two locations] — a backup without its keys
  cannot restore encrypted fields.
- **Recovery objectives:** RPO [DEPARTMENT: e.g. 24h] (backup interval),
  RTO [DEPARTMENT: e.g. 4h] (measured restore time + host provisioning).
- **Restore drills:** [DEPARTMENT: quarterly], following the drill
  procedure in BACKUP.md; date, archive tested, and time-to-restore are
  recorded in [DEPARTMENT: where]. A backup that has never been restored
  is a hope, not a plan.
- **Degraded operations:** the department can operate without the
  platform — [DEPARTMENT: reference paper/radio fallback procedures] —
  so platform recovery is never on the critical path of an emergency
  response.

## Roles

- [DEPARTMENT: role] owns backup monitoring (job success, destination
  reachability) and runs the drills.
- [DEPARTMENT: role] authorizes disaster-recovery activation and
  communicates status to membership.

[DEPARTMENT: adopted on / signature / next review]
