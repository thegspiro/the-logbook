# Audit Logging

The Logbook provides tamper-proof audit logging using a blockchain-inspired hash chain, designed with HIPAA requirements in mind for forensic investigation and security monitoring.

---

## Overview

Every significant action in the system is recorded in the audit log with:

- **Who** — User ID and username
- **What** — Action performed (create, update, delete, login, etc.)
- **When** — Timestamp (UTC)
- **Where** — IP address and user agent (voter-action events in **anonymous elections** deliberately omit the IP — audit rows are hash-chained and can never be scrubbed, so recording a voter's IP would undermine ballot secrecy permanently)
- **Details** — Specific changes (old value → new value)
- **Hash** — Keyed HMAC-SHA256 hash linking to the previous entry (legacy pre-upgrade rows use unkeyed SHA-256)

---

## What Is Logged

| Category | Actions |
|----------|---------|
| **Authentication** | Login, logout, failed login, password change, MFA setup |
| **Privacy** | Personal-data export (`user_data_export`), member anonymization (`user_anonymized` — records the user id only, never the name), consent changes (`consent_updated`) *(2026-07-31)* |
| **Records Retention** | Retention-policy changes (`retention_policy_updated`), audit archival and purge (`audit_log_archival`) *(2026-07-31)* |
| **User Management** | Create, update, delete, status change, role assignment |
| **Training** | Record creation, approval, rejection, waiver creation |
| **Elections** | Election create/update/delete, open/close/rollback, votes cast (auth, token, bulk, proxy), blocked double-vote attempts, ballot emails sent, voter overrides, proxy authorizations, vote soft-deletes, integrity checks, forensics report access, pre-meeting package sends/downloads |
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
Entry[n].hash = HMAC-SHA256(signing_key, Entry[n].data + Entry[n-1].hash)
```

1. Each entry's hash incorporates the previous entry's hash
2. Modifying any entry invalidates all subsequent hashes
3. The hash is **keyed** with the audit signing key (`AUDIT_LOG_SIGNING_KEY`, falling back to `SECRET_KEY`), so forging a valid chain requires the key, not just DB write access. Rows written before this upgrade are verified under the legacy unkeyed SHA-256 scheme, and a no-downgrade guard rejects a later unkeyed row after any keyed row
4. Periodic checkpoints create verified anchors in the chain
5. The chain is verified on demand via API

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

### Rehash / Chain Recovery — Break-Glass Only *(2026-07)*

`POST /api/v1/security/audit-log/rehash` is a **recovery** tool for the legacy
hash-computation bug, not a routine operation. Because the audit hash chain is a
single, cross-organization chain, it is now gated:

- **Disabled by default.** It returns `403` unless a server operator sets
  `AUDIT_ALLOW_CHAIN_REHASH=true`. An ordinary admin holding `audit.export`
  cannot trigger a platform-wide chain rewrite.
- **Repairs legacy rows only.** It only recomputes rows written under the legacy
  unkeyed scheme. It never rewrites a keyed (HMAC) row.
- **Fails closed.** If a keyed row's stored hash doesn't match, rehash returns
  `409` and refuses to overwrite it — a keyed mismatch is a genuine integrity
  signal (tamper or bug), not something to launder into a valid chain.

### Audit Log Export — `session_id` Redaction *(2026-07)*

`GET /api/v1/security/audit-log/export` is scoped to the caller's organization
and returns the full chain values for offline integrity verification. The raw
`session_id` is **redacted to a non-reversible SHA-256 fingerprint** — an
`audit.export` holder can still correlate events by session within an export
without receiving the live session identifier. `session_id` is not part of the
hash chain, so redacting it does not affect integrity verification.

---

## Retention Policy

| Setting | Default | Description |
|---------|---------|-------------|
| Retention period | 2555 days (7 years) | `HIPAA_AUDIT_RETENTION_DAYS`; exceeds HIPAA 6-year minimum |
| Checkpoint interval | Daily | Automatic integrity verification |
| Export format | JSON | For compliance reporting |
| Archive directory | `./audit_archives` | `AUDIT_ARCHIVE_DIR` — where purged rows are exported *(2026-07-31)* |

### Retention Enforcement *(2026-07-31)*

The retention period is now **applied**, not merely declared. The weekly
`audit_log_archival` task exports rows past retention to gzipped JSONL
archives and then deletes them from the table.

Deleting the oldest rows is exactly what the chain's head-anchor check exists
to catch, so the purge is designed not to look like tampering:

- **Checkpoint-aligned** — only whole checkpoint-covered ranges are purged, so
  the retained checkpoint Merkle roots still prove the exported archive.
- **Integrity-gated** — the range is verified immediately before export; a
  chain that fails verification is never purged.
- **Attested** — the boundary checkpoint records the last purged row's chain
  hash plus a keyed HMAC attestation. The surviving chain head verifies
  against that boundary instead of the genesis hash. An attacker with database
  access can delete rows and set the columns, but cannot mint a valid
  attestation without the audit signing key, so unsanctioned head deletion and
  forged attestations both still fail verification.

> ⚠️ **Back up `AUDIT_ARCHIVE_DIR`.** After a purge, those archives are the
> only copy of the oldest audit history. The production backup sidecar
> includes them automatically.

### Off-Host Shipping *(2026-07-31)*

The hash chain makes tampering *detectable*, but it cannot survive an attacker
deleting the whole table. Set `AUDIT_SHIP_WEBHOOK_URL` and the
`audit_log_ship` task (every 30 minutes) POSTs new entries to your collector
or SIEM as NDJSON batches:

- Each request carries `X-Logbook-Signature: sha256=<hex>` — an HMAC of the
  exact body, keyed with the audit signing key — so the collector can
  authenticate the sender, plus `X-Logbook-First-Id` / `X-Logbook-Last-Id`.
- A durable high-water mark (`audit_ship_state`) advances **only** after the
  collector answers 2xx, per batch. A failed delivery is retried on the next
  run; acknowledged rows are never re-shipped.
- Batches are bounded per run, so first enablement on an old install drains
  gradually instead of blocking the scheduler.

Unset, the task is a no-op.

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

Results are org-scoped by the `organization_id` column on `audit_logs`
*(2026-07-30)*: stamped at write time (explicitly, or auto-resolved from the
acting user), backfilled from `user_id` for rows that predate the column, and
included in the keyed hash chain from hash version 3 onward so org
attribution on new rows is tamper-proof. Platform-level events (no acting
user, no org) are visible to no organization.

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
