# Audit Logging

The Logbook provides tamper-proof audit logging using a blockchain-inspired hash chain, designed with HIPAA requirements in mind for forensic investigation and security monitoring.

---

## Overview

Every significant action in the system is recorded in the audit log with:

- **Who** — User ID and username
- **What** — Action performed (create, update, delete, login, etc.)
- **When** — Timestamp (UTC)
- **Where** — IP address and user agent
- **Details** — Specific changes (old value → new value)
- **Hash** — SHA-256 hash linking to the previous entry

---

## What Is Logged

| Category | Actions |
|----------|---------|
| **Authentication** | Login, logout, failed login, password change, MFA setup |
| **User Management** | Create, update, delete, status change, role assignment |
| **Training** | Record creation, approval, rejection, waiver creation |
| **Elections** | Election creation, ballot cast, result certification |
| **Events** | Event creation, check-in, attendance modification |
| **Inventory** | Assignment, checkout, return, clearance |
| **Settings** | Module toggle, configuration change, role permission change |
| **Security** | Alert generated, alert acknowledged, integrity check |

---

## Hash Chain Integrity

### How It Works

```
Entry[n].hash = SHA-256(Entry[n].data + Entry[n-1].hash)
```

1. Each entry's hash incorporates the previous entry's hash
2. Modifying any entry invalidates all subsequent hashes
3. Periodic checkpoints create verified anchors in the chain
4. The chain is verified on demand via API

### Verifying the Chain

```bash
# Full integrity check
curl http://YOUR-IP:3001/api/v1/security/audit-log/integrity

# Response:
{
  "status": "intact",        // or "compromised"
  "entries_checked": 15432,
  "issues": [],
  "last_verified": "2026-02-23T12:00:00Z"
}
```

### Issue Types

| Issue | Meaning |
|-------|---------|
| `hash_mismatch` | Entry data was modified after creation |
| `chain_broken` | Entry was deleted or reordered |
| `missing_entry` | Gap in the sequence |

---

## Retention Policy

| Setting | Default | Description |
|---------|---------|-------------|
| Retention period | 2555 days (7 years) | Exceeds HIPAA 6-year minimum |
| Checkpoint interval | Daily | Automatic integrity verification |
| Export format | JSON | For compliance reporting |

---

## Querying Audit Logs

### Via API

```bash
# Get recent audit entries
curl http://YOUR-IP:3001/api/v1/audit-log?limit=50

# Filter by user
curl http://YOUR-IP:3001/api/v1/audit-log?user_id=123

# Filter by action type
curl http://YOUR-IP:3001/api/v1/audit-log?action=login

# Filter by date range
curl http://YOUR-IP:3001/api/v1/audit-log?start=2026-01-01&end=2026-02-01
```

### Via UI

Navigate to **Settings > Audit Log** to browse, filter, and export audit entries.

---

## Member Audit History

In addition to the system-wide audit log, each member has a dedicated audit history page at `/members/admin/history/:userId` showing all changes to their record with timestamped entries and before/after values.

---

**See also:** [Security Overview](Security-Overview) | [Encryption](Security-Encryption) | [HIPAA Security Features](Security-HIPAA)
