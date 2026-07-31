# Logging and Monitoring Policy — Skeleton

## What is logged (platform-enforced)

Security-relevant events — authentication, permission and role changes,
data exports, anonymization, consent and retention-policy changes,
elections operations, administrative resets — are written to an
append-only audit log protected by a keyed hash chain. Tampering,
including deletion from the head of the chain, is detectable via the
built-in integrity API.

## Retention and archival

- Audit records: 7 years (`HIPAA_AUDIT_RETENTION_DAYS`), enforced by the
  weekly archival job; expired records are exported to signed archives
  before purge, and the archive directory is included in backups.
- Off-host copy: [DEPARTMENT: enable `AUDIT_SHIP_WEBHOOK_URL` to your
  collector/SIEM — the hash chain detects tampering, only an off-host
  copy survives table deletion]. Deliveries are HMAC-signed.
- Operational logs (message history, notification logs, blocked-attempt
  telemetry): per the records-retention schedule configured in
  the platform.

## Monitoring and response

- Failed logins, lockouts, geo-blocks, and anomaly detections raise
  security events; error monitoring via Sentry
  [DEPARTMENT: enabled? alert recipients?].
- [DEPARTMENT: who] reviews the audit dashboard / integrity status
  [DEPARTMENT: cadence], and verifies chain integrity
  (`GET /security/audit-log/integrity`) after any suspected incident and
  after every restore.

## Access to logs

Audit log access requires dedicated permissions and is itself audited
(`audit_log_queried`/`audit_log_exported` events). Log data is disclosed
outside the department only [DEPARTMENT: under what authority].

[DEPARTMENT: adopted on / signature / next review]
