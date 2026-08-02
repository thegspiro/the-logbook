# Cryptography and Key Management Policy — Skeleton

## Algorithms in use (platform-enforced)

- In transit: TLS 1.2/1.3 only, modern cipher suites, HSTS (nginx config).
- At rest: AES-256-GCM authenticated encryption for sensitive fields (MFA
  secrets, medical evaluation narratives, integration credentials), keys
  derived via PBKDF2-HMAC-SHA256 with an installation-specific salt.
- Integrity: keyed HMAC-SHA256 for the audit hash chain and off-host log
  deliveries.
- Passwords: Argon2id (bcrypt verified for legacy hashes).

## Key inventory and custody

| Key | Purpose | Custodian | Storage |
|---|---|---|---|
| `ENCRYPTION_KEY` + `ENCRYPTION_SALT` | Field encryption at rest | [DEPARTMENT: role] | `.env` on host + offline copies per backup policy |
| `SECRET_KEY` | Session/JWT signing | [DEPARTMENT: role] | same |
| `AUDIT_LOG_SIGNING_KEY` | Audit chain integrity | [DEPARTMENT: role] | same — never rotate casually; historical rows verify under it |
| DB/Redis passwords | Service auth | [DEPARTMENT: role] | same |
| TLS certificates | Transport | [DEPARTMENT: role] | Let's Encrypt auto-renewal |

Offline copies: at least two, sealed and access-controlled
[DEPARTMENT: locations]. **A database backup without its era's
`ENCRYPTION_KEY`/`ENCRYPTION_SALT` cannot decrypt sensitive fields — retired
keys stay archived with the backups they match** (see docs/BACKUP.md).

## Rotation

- `ENCRYPTION_KEY`: rotated on suspicion of exposure and
  [DEPARTMENT: scheduled cadence, e.g. annually], using the legacy-key
  ring procedure in docs/KEY_ROTATION.md (no downtime; drain script
  re-encrypts, then the old key is removed).
- `SECRET_KEY`: rotation signs out all sessions — schedule with notice.
- TLS: automated via certbot; monitored for renewal failure.

[DEPARTMENT: adopted on / signature / next review]
