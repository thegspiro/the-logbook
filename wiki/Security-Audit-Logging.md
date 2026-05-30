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
| **Medical Screening** | Requirement creation/update/delete, screening record creation/update/delete *(2026-03-29)* |
| **Documents** | Document upload (filename, MIME type, file size), document delete *(2026-03-29)* |
| **Membership Pipeline** | Pipeline created/deleted, prospect created/advanced/transferred *(2026-03-29)* |
| **Messages** | Message creation and deletion *(2026-03-29)* |
| **Shift Completion Reports** | Report created, updated, reviewed (approved/flagged/redacted), acknowledged by trainee, bulk submitted *(2026-04-07)* |
| **Salesforce Sync** | Sync triggered, sync completed, webhook received, contact created/updated *(2026-04-11)* |
| **Training Programs** | Program exported, program imported *(2026-04-11)* |
| **Authentication (OAuth)** | `oauth_login` — successful sign-in via Google or Microsoft *(2026-05-29)* |
| **Events** | `event_attendee_overwritten` (severity `warning`) — a manager overwrote an existing RSVP when adding an attendee *(2026-05-29)* |
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

### Hash Chain Reliability Fix *(2026-04-11)*

A `_build_hash_data()` helper was extracted in `core/audit.py` to prevent drift between hash verification, creation, and rehashing operations. Previously, the hash chain could report false "compromised" results if the field ordering differed between when an entry was created and when it was verified. The helper ensures consistent field ordering across all hash operations.

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

### Admin Read API *(2026-05-29)*

A dedicated admin read API (permission `audit.view`) exposes the audit trail for
browsing and filtering:

```
GET /api/v1/audit-logs            # filters: event_type, event_category,
                                  #   severity (info|warning|critical), user_id,
                                  #   search, start_date, end_date, skip, limit (1-500)
GET /api/v1/audit-logs/stats      # counts by severity and category
GET /api/v1/audit-logs/{log_id}   # single entry
```

Results are org-scoped by joining through users (only entries whose `user_id`
belongs to the caller's organization); NULL-user system events are excluded.

### Via UI

Navigate to the **Audit Log** admin page at `/admin/audit-log` *(2026-05-29)*
(or **Settings > Audit Log**) to browse, filter, and export audit entries.

> **Note on client IPs** *(2026-05-29)*: the IP recorded in audit/security
> events comes from the spoof-proof `get_client_ip()` resolver. Behind a reverse
> proxy you must set `TRUSTED_PROXY_IPS` or all entries will show the proxy's IP.
> See [Security Configuration](Configuration-Security#client-ip-resolution--geoip-2026-05-29).

---

## Member Audit History

In addition to the system-wide audit log, each member has a dedicated audit history page at `/members/admin/history/:userId` showing all changes to their record with timestamped entries and before/after values.

---

**See also:** [Security Overview](Security-Overview) | [Encryption](Security-Encryption) | [HIPAA Security Features](Security-HIPAA)
