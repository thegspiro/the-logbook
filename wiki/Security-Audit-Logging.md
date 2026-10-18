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

**Sealing:** an entry is written in the same transaction as the action it
records, without its hash, and joined to the chain moments later by a sealer
that takes one lock (the `audit_chain_head` row) in its own short transaction —
so concurrent writers cannot fork the chain, and a rolled-back action never
reaches it. Chain order is `chain_seq`, not `id`. The integrity check reports
entries still waiting as `pending_seal`, not as tampering; the
`audit_chain_seal` task (every minute) seals anything the after-commit sealer
missed.

---

## What Is Logged

| Category                       | Actions                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Authentication**             | Password sign-in (`login`, with `method`), refused sign-in (`login_failed`, with `reason` and `stage`), the attempt that locks an account (`account_locked`), an administrator unlocking it (`account_unlocked`), sign-out (`logout`), OAuth sign-in via Google or Microsoft (`oauth_login`), MFA enabled/disabled, recovery codes regenerated, MFA policy changes, password-reset requested/completed/failed (a completed reset names the member), a self-service password change (`password_changed`) and a refused one (`password_change_failed`, with `reason`) |
| **Privacy**                    | Personal-data export (`user_data_export`), member anonymization (`user_anonymized` — records the user id only, never the name), consent changes (`consent_updated`)                                                                                                                                                                                                                                                                                                                                                                                                 |
| **Records Retention**          | Retention-policy changes (`retention_policy_updated`), audit archival and purge (`audit_log_archival`)                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| **User Management**            | Create, update, delete, status change, role assignment; service-history edits (`member_service_history_updated`)                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| **Member PII**                 | `user_viewed` carries `restricted_pii_disclosed` — `true` when the viewer is leadership reading _another_ member's record, i.e. the only path that discloses a date of birth and a family's names and phone numbers. The flag makes the trail answer "who saw it", not merely "who looked"                                                                                                                                                                                                                                                                          |
| **Member badges and ID cards** | `member_badge_reissued`, `member_badge_settings_updated` (Accept old badges), `id_card_layout_updated`, `id_cards_printed` (count only)                                                                                                                                                                                                                                                                                                                                                                                                                             |
| **Training**                   | Record creation, approval, rejection, waiver creation; `self_report_attachment_retention` (per organization sweep: the retention period, files deleted, and the submission and training-record ids), `self_report_attachment_retention_updated` (the period changed), `course_cohort_missed_class_credited`                                                                                                                                                                                                                                                         |
| **Training Programs**          | Program exported, program imported                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| **Shift Completion Reports**   | Report created, updated, reviewed (approved/flagged/redacted), acknowledged by trainee, bulk submitted                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| **Scheduling**                 | `shift_exchange_qualification_override` — a duty officer approved an exchange with Approve anyway                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| **Elections**                  | Election create/update/delete, open/close/rollback, votes cast (auth, token, bulk, proxy), blocked double-vote attempts, ballot emails sent, voter overrides, proxy authorizations, vote soft-deletes, integrity checks, forensics report access, pre-meeting package sends/downloads                                                                                                                                                                                                                                                                               |
| **Events**                     | Event creation, check-in, attendance modification; `event_attendee_overwritten` (severity `warning`) — a manager overwrote an existing RSVP when adding an attendee                                                                                                                                                                                                                                                                                                                                                                                                 |
| **Inventory**                  | Assignment, checkout, return, clearance; self-service kiosk loans (`inventory_kiosk_checkout`) and returns (`inventory_kiosk_return`, severity `warning` when returned damaged)                                                                                                                                                                                                                                                                                                                                                                                     |
| **Equipment checks**           | Bulk linking of checklist items to inventory catalog entries writes a `log_template_change` entry (action `update`, with `inventory_links` and `changed_count`)                                                                                                                                                                                                                                                                                                                                                                                                     |
| **Settings**                   | Module toggle, configuration change, role permission change; required member emails (`member_email_policy_updated`, before and after lists)                                                                                                                                                                                                                                                                                                                                                                                                                         |
| **Administration**             | `email_link_domain_changed` (severity `warning`) — the email link address was saved or cleared on Settings → Email, with the previous and new address                                                                                                                                                                                                                                                                                                                                                                                                               |
| **Medical Screening**          | Requirement creation/update/delete, screening record creation/update/delete                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| **Documents**                  | Document upload (filename, MIME type, file size), document delete                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| **Membership Pipeline**        | Pipeline created/deleted, prospect created/advanced/transferred                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| **Messages**                   | Message creation and deletion                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| **Salesforce Sync**            | Sync triggered, sync completed, webhook received, contact created/updated                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| **Finance**                    | `finance.dues_waiver_reversed` (severity `warning`) records only the dues id and restored status — the original waive reason is erased rather than copied into the log, because free-text waiver reasons may contain personal information and the immutable audit log must not hold data that privacy scrubbing cannot reach. `finance.approval_step_approved` / `finance.approval_step_denied` record `override`, `approver_type`, `approver_value` and, for an approvals-admin override, `override_reason`; an override is logged at `warning`                    |
| **Security**                   | Alert generated, alert acknowledged, integrity check                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |

Two related records are **not** audit events:

- **Scheduled-task failures** are written to the error log as
  `SCHEDULED_TASK_FAILED` per organization and shown on Error Monitoring as
  "Scheduled task".
- **Error logs** pass route paths through `sanitize_path()`, which redacts
  token-bearing params (finance approval tokens, application-status tokens,
  `.ics` calendar-feed tokens) before storage.

---

## Hash Chain Integrity

### How It Works

```
Entry[n].hash = HMAC-SHA256(signing_key, Entry[n].data + Entry[n-1].hash)
```

1. Each entry's hash incorporates the previous entry's hash
2. Modifying any entry invalidates all subsequent hashes
3. The hash is **keyed** with the audit signing key (`AUDIT_LOG_SIGNING_KEY`, falling back to `SECRET_KEY`), so forging a valid chain requires the key, not just DB write access. Rows written before the HMAC upgrade are verified under the legacy unkeyed SHA-256 scheme, and a no-downgrade guard rejects a later unkeyed row after any keyed row
   - Each row records `signing_key_id`, a short fingerprint of the key that signed it (never the key), and is verified only against that key. Rows signed with `SECRET_KEY` before a dedicated `AUDIT_LOG_SIGNING_KEY` took effect keep verifying, but only up to the first row signed with the dedicated key; a `SECRET_KEY` row after that is reported as tampered. Each verification run logs one `WARNING` when it used `SECRET_KEY`. Ballots (`VOTE_SIGNING_KEY`) follow the same rule. See `docs/KNOWN_LIMITATIONS.md` for what the bound does not cover
4. One helper (`_build_hash_data()` in `core/audit.py`) builds the hashed fields for creation, verification and rehash alike, so the three cannot drift apart in field order and report a false "compromised" result
5. Checkpoints (created weekly by `audit_log_archival`, or on demand via `POST /api/v1/security/audit-log/checkpoint`) create verified anchors in the chain
6. The chain is verified on demand via API

### Verifying the Chain

```bash
# Full integrity check (permission audit.view); optional start_id / end_id
curl http://YOUR-IP:3001/api/v1/security/audit-log/integrity

# Response:
{
  "verified": true,
  "total_checked": 15432,
  "pending_seal": 0,
  "first_id": 1,
  "last_id": 15432,
  "errors": [],
  "message": "Audit log integrity verified"   // or "INTEGRITY FAILURE DETECTED"
}
```

### What a Failure Reports

Each entry in `errors` names the `log_id` and an `error` message:

| Error                                       | Meaning                                                                                        |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Hash mismatch (with expected/calculated)    | Entry data was modified after creation                                                         |
| Chain broken — previous hash does not match | An entry was deleted or reordered mid-chain                                                    |
| Chain head missing                          | The first entry links to neither genesis nor an attested archival boundary (head rows removed) |
| Chain tail truncated                        | A checkpoint attests entries past where the chain now ends (newest rows removed)               |
| Unkeyed hash past the legacy boundary       | An unkeyed row sits above `AUDIT_LOG_LEGACY_MAX_ID` (see below)                                |
| Hash version downgrade                      | An entry uses an older, unkeyed algorithm than earlier entries                                 |

### Rehash / Chain Recovery — Break-Glass Only

`POST /api/v1/security/audit-log/rehash` is a **recovery** tool for a legacy
hash-computation bug, not a routine operation. Because the audit hash chain is
a single, cross-organization chain, it is gated:

- **Disabled by default.** It returns `403` unless a server operator sets
  `AUDIT_ALLOW_CHAIN_REHASH=true`. An ordinary admin holding `audit.export`
  cannot trigger a platform-wide chain rewrite.
- **Repairs legacy rows only.** It only recomputes rows written under the legacy
  unkeyed scheme. It never rewrites a keyed (HMAC) row.
- **Fails closed.** If a keyed row's stored hash doesn't match, rehash returns
  `409` and refuses to overwrite it — a keyed mismatch is a genuine integrity
  signal (tamper or bug), not something to launder into a valid chain.

### Legacy Hash Boundary Is Pinned in Config

Which rows are _allowed_ to use the legacy unkeyed SHA-256 scheme is not
decided by the row's own `hash_version` column — that column lives in the same
attacker-writable table the chain protects, so trusting it would let an
attacker with SQL write access rewrite the entire keyed suffix, mark every
forged row as version 1, and recompute a "valid" chain **without the HMAC
key**.

The trust boundary lives in application configuration, outside the audit
database: **`AUDIT_LOG_LEGACY_MAX_ID`** (default `0`).

- **New installations leave it at `0`** — no row may verify unkeyed, ever.
- **Upgraded installations set it once**, to the last `audit_logs.id` that
  existed immediately before the HMAC upgrade. Rows at or below it verify
  under legacy SHA-256; any unkeyed row _above_ it fails verification with
  "Unkeyed hash is not permitted after the trusted legacy audit boundary".
- **Rehash fails closed** on the same rule: an unkeyed row past the boundary
  aborts `POST /security/audit-log/rehash` with a "hash-version downgrade
  attack" error rather than laundering it into the chain.

### Audit Log Export — `session_id` Redaction

`GET /api/v1/security/audit-log/export` is scoped to the caller's organization
and returns the full chain values for offline integrity verification. The raw
`session_id` is **redacted to a non-reversible SHA-256 fingerprint** — an
`audit.export` holder can still correlate events by session within an export
without receiving the live session identifier. `session_id` is not part of the
hash chain, so redacting it does not affect integrity verification.

---

## Retention Policy

| Setting             | Default             | Description                                                |
| ------------------- | ------------------- | ---------------------------------------------------------- |
| Retention period    | 2555 days (7 years) | `HIPAA_AUDIT_RETENTION_DAYS`; exceeds HIPAA 6-year minimum |
| Checkpoint interval | Weekly              | `audit_log_archival`, Sundays 02:00                        |
| Export format       | JSON                | For compliance reporting                                   |
| Archive directory   | `./audit_archives`  | `AUDIT_ARCHIVE_DIR` — where purged rows are exported       |

### Retention Enforcement

The retention period is applied, not merely declared. The weekly
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

Archive directories are created with mode `0700` and archive files with `0600`,
through an exclusive file descriptor, so audit data is never briefly readable
with a permissive mode. Archives written before this behaviour existed keep
whatever mode they were given; check them by hand rather than loosening the
live archive path for backup convenience.

> ⚠️ **Back up `AUDIT_ARCHIVE_DIR`.** After a purge, those archives are the
> only copy of the oldest audit history. The production backup sidecar
> includes them automatically.

### Off-Host Shipping

The hash chain makes tampering _detectable_, but it cannot survive an attacker
deleting the whole table. Set `AUDIT_SHIP_WEBHOOK_URL` and the
`audit_log_ship` task (every 30 minutes) POSTs newly sealed entries, in chain
order, to your collector or SIEM as NDJSON batches:

- Each request carries `X-Logbook-Signature: sha256=<hex>` — an HMAC of the
  exact body, keyed with the audit signing key — so the collector can
  authenticate the sender, plus `X-Logbook-First-Id` / `X-Logbook-Last-Id`
  and `X-Logbook-First-Seq` / `X-Logbook-Last-Seq` (chain positions — the ones
  to deduplicate on, since ids in a batch need not be ascending).
- A durable high-water mark (`audit_ship_state`) advances **only** after the
  collector answers 2xx, per batch. A failed delivery is retried on the next
  run; acknowledged rows are never re-shipped.
- Batches are bounded per run, so first enablement on an old install drains
  gradually instead of blocking the scheduler.

Unset, the task is a no-op.

---

## Querying Audit Logs

### Via API

The admin read API (permission `audit.view`) exposes the audit trail for
browsing and filtering:

```
GET /api/v1/audit-logs            # filters: event_type, event_category,
                                  #   severity (info|warning|critical), user_id,
                                  #   search, start_date, end_date, skip, limit (1-500)
GET /api/v1/audit-logs/stats      # counts by severity and category
GET /api/v1/audit-logs/{log_id}   # single entry
```

```bash
# Recent entries
curl "http://YOUR-IP:3001/api/v1/audit-logs?limit=50"

# Filter by user
curl "http://YOUR-IP:3001/api/v1/audit-logs?user_id=<user-id>"

# Filter by event type
curl "http://YOUR-IP:3001/api/v1/audit-logs?event_type=login"

# Filter by date range
curl "http://YOUR-IP:3001/api/v1/audit-logs?start_date=2026-01-01T00:00:00Z&end_date=2026-02-01T00:00:00Z"
```

Results are org-scoped by the `organization_id` column on `audit_logs`:
stamped at write time (explicitly, or auto-resolved from the acting user),
backfilled from `user_id` for rows that predate the column, and included in
the keyed hash chain from hash version 3 onward so org attribution on new rows
is tamper-proof. Platform-level events (no acting user, no org) are visible to
no organization.

### Via UI

Navigate to the **Audit Log** admin page at `/admin/audit-log` to browse,
filter, and export audit entries.

> **Note on client IPs:** the IP recorded in audit/security events comes from
> the spoof-proof `get_client_ip()` resolver. Behind a reverse proxy you must
> set `TRUSTED_PROXY_IPS` or all entries will show the proxy's IP. See
> [Security Configuration](Configuration-Security#client-ip-resolution--geoip-2026-05-29).

---

## Member Audit History

In addition to the system-wide audit log, each member has a dedicated audit history page at `/members/admin/history/:userId` showing all changes to their record with timestamped entries and before/after values.

---

**See also:** [Security Overview](Security-Overview) | [Encryption](Security-Encryption) | [HIPAA Security Features](Security-HIPAA)
