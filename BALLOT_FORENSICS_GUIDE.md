# Ballot Forensics Guide

**Last Updated:** 2026-02-12
**Audience:** Election administrators, system auditors, organization leadership

---

## Overview

This guide explains how to investigate a disputed election using The Logbook's built-in forensic tools. Every election operation is logged to a tamper-proof audit trail with cryptographic hash chains, and every vote carries an HMAC-SHA256 signature for tampering detection.

---

## Quick Reference: Available Tools

| Tool | Endpoint | What It Does |
|------|----------|-------------|
| **Forensics Report** | `GET /elections/{id}/forensics` | Full aggregated report (start here) |
| **Integrity Check** | `GET /elections/{id}/integrity` | Verify all vote signatures |
| **Election Stats** | `GET /elections/{id}/stats` | Ballot counts and turnout |
| **Election Results** | `GET /elections/{id}/results` | Candidate vote counts |
| **Soft-Delete Vote** | `DELETE /elections/{id}/votes/{vote_id}` | Remove vote with reason |

All endpoints require `elections.manage` permission.

---

## Step-by-Step: Investigating a Disputed Election

### Step 1: Pull the Forensics Report

```
GET /api/v1/elections/{election_id}/forensics
```

This single call returns everything you need:

- **`vote_integrity`** — Did any votes get tampered with?
- **`deleted_votes`** — Were any votes soft-deleted? By whom? Why?
- **`rollback_history`** — Was the election status ever rolled back?
- **`voting_tokens`** — Token issuance and usage data
- **`audit_log`** — Chronological audit trail of all operations
- **`anomaly_detection`** — Suspicious IP addresses, vote clustering
- **`voting_timeline`** — Votes per hour (detect stuffing patterns)

### Step 2: Check Vote Integrity

In the forensics report, look at the `vote_integrity` section:

```json
{
  "vote_integrity": {
    "total_votes": 45,
    "valid_signatures": 45,
    "unsigned_votes": 0,
    "tampered_votes": 0,
    "tampered_vote_ids": [],
    "integrity_status": "PASS"
  }
}
```

- **PASS** — All vote signatures are valid. No database-level tampering detected.
- **FAIL** — One or more votes have been modified after casting. The `tampered_vote_ids` array identifies exactly which votes were altered.

**How it works:** Each vote is signed with `HMAC-SHA256(vote_id:election_id:candidate_id:voter_hash:position:voted_at, VOTE_SIGNING_KEY)`. If any field is changed in the database, the signature won't match.

### Step 3: Review Anomaly Detection

Check the `anomaly_detection` section:

```json
{
  "anomaly_detection": {
    "suspicious_ips": {
      "192.168.1.50": 12
    },
    "ip_vote_distribution": {
      "192.168.1.50": 12,
      "10.0.0.5": 3,
      "10.0.0.8": 2
    }
  }
}
```

- **`suspicious_ips`** — Any IP address that cast more than 5 votes. In a fire department election, this could be a shared station computer (normal) or could indicate someone voting from the same device multiple times (suspicious).
- **Context matters:** A shared computer at the station will naturally have multiple votes from one IP. But 20+ votes from a home IP is unusual.

### Step 4: Examine the Voting Timeline

```json
{
  "voting_timeline": {
    "2026-02-10 09:00": 2,
    "2026-02-10 10:00": 5,
    "2026-02-10 11:00": 3,
    "2026-02-10 14:00": 15,
    "2026-02-10 14:01": 20
  }
}
```

Look for:
- **Normal pattern:** Votes spread throughout the voting period
- **Suspicious pattern:** Large burst of votes in a very short window (potential ballot stuffing)
- **Late votes:** Votes near the deadline are normal; votes *after* the deadline should be impossible (blocked by the system)

### Step 5: Review the Audit Trail

The `audit_log.entries` array shows a chronological history:

```json
{
  "event_type": "election_opened",
  "timestamp": "2026-02-10T08:00:00",
  "user_id": "abc-123",
  "severity": "info"
}
```

**Key event types to look for:**

| Event Type | Severity | What It Means |
|------------|----------|--------------|
| `election_created` | info | Election was created |
| `election_opened` | info | Voting started |
| `election_closed` | info | Voting ended |
| `election_rollback` | warning | Status was rolled back (check reason) |
| `vote_cast` | info | Normal vote cast |
| `vote_cast_token` | info | Anonymous vote via email token |
| `vote_double_attempt` | warning | Someone tried to vote twice (blocked) |
| `vote_double_attempt_token` | warning | Token double-vote attempt (blocked) |
| `vote_soft_deleted` | warning | Admin removed a vote (check reason) |
| `vote_integrity_check` | info/critical | Integrity check was run |
| `ballot_emails_sent` | info | Ballot notification emails distributed |
| `forensics_report_generated` | info | Someone pulled this report |
| `runoff_election_created` | info | Automatic runoff triggered |

### Step 6: Check for Deleted Votes

```json
{
  "deleted_votes": {
    "count": 2,
    "records": [
      {
        "vote_id": "vote-abc",
        "candidate_id": "candidate-xyz",
        "position": "Chief",
        "deleted_at": "2026-02-10T15:30:00",
        "deleted_by": "user-456",
        "deletion_reason": "Voter reported coerced vote, requested removal"
      }
    ]
  }
}
```

Soft-deleted votes are **never physically removed** from the database. They remain for full accountability. Check:
- **Who deleted it?** (`deleted_by`)
- **Why?** (`deletion_reason`)
- **Was it before or after closing?** (compare `deleted_at` with election `end_date`)

### Step 7: Review Rollback History

```json
{
  "rollback_history": [
    {
      "timestamp": "2026-02-10T16:00:00",
      "performed_by": "user-789",
      "from_status": "closed",
      "to_status": "open",
      "reason": "Error in ballot distribution - 3 eligible voters did not receive tokens"
    }
  ]
}
```

Every status rollback requires a reason and is emailed to all leadership members. Verify:
- Was the reason legitimate?
- Did the rollback extend the voting window unfairly?
- Were additional votes cast during the reopened window?

### Step 8: Examine Token Usage (Anonymous Voting)

```json
{
  "voting_tokens": {
    "total_issued": 30,
    "total_used": 25,
    "records": [
      {
        "used": true,
        "access_count": 3,
        "first_accessed_at": "2026-02-10T09:15:00",
        "positions_voted": ["Chief", "President"]
      }
    ]
  }
}
```

Check for:
- **Tokens never used** — Did all eligible voters receive their tokens?
- **High access counts** — A token accessed many times but not used may indicate someone struggling with the system (or attempting unauthorized access)
- **Token usage timing** — Were tokens used before the election opened? (should be impossible)

---

## Common Investigation Scenarios

### Scenario: "The vote count doesn't match what we expected"

1. Pull forensics report
2. Check `deleted_votes.count` — were any votes removed?
3. Check `vote_integrity` — were any votes tampered with?
4. Compare `voting_tokens.total_issued` vs `total_used` — any unaccounted tokens?

### Scenario: "We suspect someone voted twice"

1. Pull forensics report
2. Search `audit_log.entries` for `vote_double_attempt` events
3. Check `anomaly_detection.suspicious_ips` for IP clustering
4. The system blocks double-voting at the database level, so if a double attempt occurred, it was caught and logged

### Scenario: "An admin may have manipulated votes"

1. Run `GET /elections/{id}/integrity` — any `FAIL` result means database tampering occurred
2. Check `audit_log.entries` for `vote_soft_deleted` events
3. Review `deleted_votes.records` for deletion reasons
4. The audit log itself is tamper-proof (blockchain hash chain) — if someone tried to cover their tracks by editing audit entries, the hash chain verification will fail

### Scenario: "The election was rolled back suspiciously"

1. Check `rollback_history` for the rollback reason and performer
2. Cross-reference with `audit_log.entries` — the `election_rollback` event has the full context
3. Check if additional votes were cast after the rollback by looking at vote timestamps vs rollback timestamp
4. All leadership members received email notification of the rollback

### Scenario: "We need to verify the entire audit trail is intact"

The audit log uses blockchain-inspired hash chains. Each entry's hash depends on the previous entry, making it impossible to insert, delete, or modify entries without detection.

The system automatically verifies the audit chain on startup (in production). To manually verify:
- The audit log integrity is verified automatically in the background
- Any tampering triggers `CRITICAL` severity logging
- The `forensics_report_generated` events in the audit log show who has been reviewing the data

---

## Preserving Evidence

If you suspect fraud and may need to escalate:

1. **Pull the forensics report immediately** — Save the JSON response
2. **Do not delete or modify anything** — All operations are logged
3. **Note the timestamp** — The audit log proves the state at the time of your report
4. **Export audit logs** — The hash chain proves completeness

### Data Retention

- **Votes:** Never hard-deleted (soft-delete only with audit trail)
- **Audit logs:** Append-only with cryptographic hash chains
- **Voting tokens:** Retained with access history
- **Rollback history:** Stored on election record permanently

### Voter Anonymity Protection

For anonymous elections:
- `voter_id` is **never stored** on votes
- Voters are tracked via `voter_hash` (HMAC-SHA256 of user ID + election-specific salt)
- The salt (`voter_anonymity_salt`) can be destroyed after the election to make de-anonymization **permanently impossible**
- Even with the salt, recovering voter identity requires access to both the salt and user IDs, plus the hashing algorithm

---

## Environment Configuration

| Variable | Purpose | Default |
|----------|---------|---------|
| `VOTE_SIGNING_KEY` | HMAC key for vote signatures | `default-signing-key` (change in production!) |

**Important:** Change `VOTE_SIGNING_KEY` to a strong random value in production. If the key is compromised, an attacker could forge valid vote signatures.

---

## API Reference

### `GET /elections/{id}/forensics`

**Permission:** `elections.manage`

**Response:** Complete forensics report (see Step 1 above)

### `GET /elections/{id}/integrity`

**Permission:** `elections.manage`

**Response:**
```json
{
  "election_id": "...",
  "total_votes": 45,
  "valid_signatures": 45,
  "unsigned_votes": 0,
  "tampered_votes": 0,
  "tampered_vote_ids": [],
  "integrity_status": "PASS"
}
```

### `DELETE /elections/{id}/votes/{vote_id}?reason=...`

**Permission:** `elections.manage`

**Response:**
```json
{
  "message": "Vote soft-deleted successfully",
  "vote_id": "..."
}
```

---

## Audit Event Reference

All election events are logged to the tamper-proof `audit_logs` table with `event_category = "elections"`.

| Event Type | When | Data Included |
|------------|------|---------------|
| `election_created` | Election created | ID, title, type, voting method |
| `election_opened` | Voting opened | ID, title, candidate count |
| `election_closed` | Voting closed | ID, title |
| `election_deleted` | Election deleted | ID, title |
| `election_rollback` | Status rolled back | ID, from/to status, reason |
| `vote_cast` | Authenticated vote | Election ID, vote ID, position |
| `vote_cast_token` | Anonymous token vote | Election ID, vote ID, position |
| `vote_double_attempt` | Double-vote blocked (auth) | Election ID, position |
| `vote_double_attempt_token` | Double-vote blocked (token) | Election ID, position |
| `vote_soft_deleted` | Vote removed by admin | Vote ID, election ID, reason |
| `vote_integrity_check` | Integrity verification run | Total, valid, tampered count |
| `ballot_emails_sent` | Email ballots distributed | Election ID, success/failed counts |
| `runoff_election_created` | Automatic runoff | Parent and runoff election IDs |
| `forensics_report_generated` | Forensics report pulled | Election ID |
