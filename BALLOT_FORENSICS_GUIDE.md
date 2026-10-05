# Ballot Forensics Guide

**Last Updated:** 2026-10-04
**Audience:** Election administrators, system auditors, organization leadership

---

## Overview

This guide explains how to investigate a disputed election using The Logbook's built-in forensic tools. Every election operation is logged to a tamper-proof audit trail with cryptographic hash chains, and every vote carries an HMAC-SHA256 signature for tampering detection.

---

## Quick Reference: Available Tools

| Tool                     | Endpoint                                      | What It Does                                                                                                 |
| ------------------------ | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| **Forensics Report**     | `GET /elections/{id}/forensics`               | Full aggregated report (start here)                                                                          |
| **Integrity Check**      | `GET /elections/{id}/integrity`               | Verify all vote signatures                                                                                   |
| **Election Stats**       | `GET /elections/{id}/stats`                   | Ballot counts and turnout                                                                                    |
| **Election Results**     | `GET /elections/{id}/results`                 | Candidate vote counts                                                                                        |
| **Soft-Delete Vote**     | `DELETE /elections/{id}/votes/{vote_id}`      | Remove vote with reason                                                                                      |
| **Receipt Verification** | `GET /elections/{id}/verify-receipt?receipt=` | Confirm a voter's receipt maps to a recorded vote                                                            |
| **Paper Batches**        | `GET /elections/{id}/manual-ballots`          | Paper-tally batches with recorder, status, and attestation trail                                             |
| **Certified Results**    | `GET /elections/{id}/certified-results`       | Formal results PDF: tallies, quorum, attestation trail, integrity result, signature lines (closed elections) |

All endpoints require `elections.manage` permission, except receipt verification,
which is public (rate-limited) so voters can check their own receipts.

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

**How it works:** Each vote is signed with
`HMAC-SHA256(vote_id:election_id:candidate_id:voter_hash:position:vote_rank:is_proxy_vote:proxy_delegating_user_id:voted_at, VOTE_SIGNING_KEY)`.
If any of these fields is changed in the database — including a rank change on a
ranked-choice vote or converting a proxy vote — the signature won't match.

**Paper (manual) ballots (since 2026-07-29):** in-room paper tallies are stored
as one vote row per paper ballot, flagged `is_manual`, attributed to the
recording officer (`recorded_by`), and grouped by `manual_batch_id`. Manual
votes carry **no voter identity and no dedup hash** — the officers' attested
count is the source of truth — but they are signed and chained exactly like
electronic votes, and the signature covers the `is_manual` flag, so a stored
paper vote cannot be silently re-labeled as electronic (or vice versa). The
integrity check therefore covers the full mixed ballot box. When auditing a
mixed election, also pull `GET /elections/{id}/manual-ballots`: each batch shows
its recorder, status (`pending` / `confirmed` / `voided`), and the officers who
attested it. Only **confirmed** batches count toward results — a batch still
pending at close is excluded from the certified totals and flagged by a
warning `election_manual_ballots_unattested_at_close` audit event. The
requirement (default 2 attesting officers, never the recorder) is snapshotted
per batch at record time. Stats report `manual_votes` / `electronic_votes`
separately, so the mix is always visible when reconciling counts.

**Write-in consolidation (since 2026-07-29):** merged write-in variants are
aliased via `candidates.merged_into_candidate_id` — vote rows are **never
edited** (their signatures cover the original candidate), and results re-map
variants to the target at tally time. When reconciling raw vote rows against
displayed results, resolve the alias first; the merge itself appears in the
audit trail as `election_write_ins_merged`.

### Step 3: Review Anomaly Detection

Check the `anomaly_detection` section:

```json
{
  "anomaly_detection": {
    "suspicious_ips": {
      "192.168.1.50": 12
    },
    "unique_ip_count": 7,
    "ip_metadata_purged": false
  }
}
```

- **`suspicious_ips`** — Any IP address that cast more than 5 votes. In a fire department election, this could be a shared station computer (normal) or could indicate someone voting from the same device multiple times (suspicious).
- **`unique_ip_count`** — How many distinct IPs cast votes, without listing them. The full per-IP vote map is deliberately **not** exposed (since 2026-07): in a small department it allowed correlating anonymous votes to voters.
- **`ip_metadata_purged`** — `true` once an anonymous election has closed: per-vote IP/user-agent metadata is erased at close (alongside the anonymity salt), so run IP-based analysis **while voting is open** — after close it is gone by design.
- **Context matters:** A shared computer at the station will naturally have multiple votes from one IP. But 20+ votes from a home IP is unusual.

> **IP cutover — 2026-08-05.** Before the 2026-08-05 release, every vote and
> audit row behind the production nginx recorded the **proxy's** internal
> address, not the voter's (app review AXC-1). On an installation that ran an
> earlier release behind a reverse proxy, any vote or audit row written before
> it upgraded past 2026-08-05 carries that one proxy address: `unique_ip_count`
> reads 1 and `suspicious_ips` flags it for every such election. That is the
> recording defect, not ballot stuffing. Those rows are **not rewritten** —
> audit rows are hash-chained, and correcting them would break
> `verify_integrity` — so a reviewer must date the evidence: an IP stored
> before the installation's upgrade to the 2026-08-05 release is not a client
> address and cannot support an IP-based finding. Per-vote IPs of a closed
> anonymous election are purged at close anyway; the pre-cutover values
> survive mainly in audit rows and in named (non-anonymous) elections.

### Step 4: Examine the Voting Timeline

```json
{
  "voting_timeline": {
    "2026-02-10 09:00": 2,
    "2026-02-10 10:00": 5,
    "2026-02-10 11:00": 3,
    "2026-02-10 14:00": 15
  },
  "voting_timeline_timezone": "America/Chicago"
}
```

Buckets are whole hours. **Since 2026-09-27 they are the department's local
hours**, named in `voting_timeline_timezone`; before that they were UTC hours,
so an evening vote landed in the next day's bucket. Compare a timeline pulled
before that date with one pulled after it with the offset in mind. (The
example above used to show a `14:01` bucket, which the hourly bucketing never
produces.)

Look for:

- **Normal pattern:** Votes spread throughout the voting period
- **Suspicious pattern:** Large burst of votes in a very short window (potential ballot stuffing)
- **Late votes:** Votes near the deadline are normal; votes _after_ the deadline should be impossible (blocked by the system)

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

**Who the entry names** _(since 2026-09-30)_:

- On an **anonymous** election, `vote_cast` rows carry no `user_id` and no
  voter in `event_data`. Rows written before that date do name the in-app
  voter beside the `vote_id` — they cannot be scrubbed without breaking the
  hash chain, so treat the audit trail of an anonymous election held before
  the fix as naming its in-app voters (`docs/KNOWN_LIMITATIONS.md`).
- `election_closed` carries the closing officer as `user_id`, plus
  `closed_at` and `automatic` in `event_data`; the election itself stores
  `closed_at` / `closed_by`, which the certified PDF and the report print.
  Elections closed before the change have neither and show the scheduled end
  as an automatic close.
- The **Audit Log** page now shows the officer's username for each row; it
  read "system" for every row while the API held the real `user_id`.
- `runoff_election_created` is written with the parent's `election_id` and
  mirrored on the runoff, so it appears in both elections' forensics (it had no
  `election_id` and appeared in neither).

**Key event types to look for:**

| Event Type                                       | Severity           | What It Means                                                               |
| ------------------------------------------------ | ------------------ | --------------------------------------------------------------------------- |
| `election_created`                               | info               | Election was created                                                        |
| `election_opened`                                | info               | Voting started                                                              |
| `election_closed`                                | info               | Voting ended — by whom, or `automatic: true`                                |
| `election_deleted_critical` / `election_deleted` | critical / warning | An election was deleted (written after the delete commits since 2026-09-30) |
| `election_rollback`                              | warning            | Status was rolled back (check reason)                                       |
| `vote_cast`                                      | info               | Normal vote cast                                                            |
| `vote_cast_token`                                | info               | Anonymous vote via email token                                              |
| `vote_double_attempt`                            | warning            | Someone tried to vote twice (blocked)                                       |
| `vote_double_attempt_token`                      | warning            | Token double-vote attempt (blocked)                                         |
| `vote_soft_deleted`                              | warning            | Admin removed a vote (check reason)                                         |
| `vote_integrity_check`                           | info/critical      | Integrity check was run                                                     |
| `ballot_emails_sent`                             | info               | Ballot notification emails distributed                                      |
| `forensics_report_generated`                     | info               | Someone pulled this report                                                  |
| `runoff_election_created`                        | info               | Automatic runoff triggered                                                  |
| `election_auto_opened` / `election_auto_closed`  | info               | Lifecycle task opened/closed the election on schedule                       |
| `election_reminder_sent`                         | info               | Non-voter reminder ballots sent (manual or automatic)                       |
| `election_manual_ballots_recorded`               | info/warning       | Paper tally recorded (warning when the over-count override was used)        |
| `election_manual_ballots_attested`               | info               | An officer attested a paper batch                                           |
| `election_manual_ballots_voided`                 | warning            | A paper batch was voided (check reason)                                     |
| `election_manual_ballots_unattested_at_close`    | warning            | Election closed with a batch still pending — its votes are excluded         |
| `election_tie_detected`                          | info               | A tie was flagged under a non-co-winners tie policy                         |
| `election_write_ins_merged`                      | info               | Write-in variants consolidated (alias only; vote rows untouched)            |
| `election_cloned`                                | info               | A fresh draft was cloned from this election                                 |

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
        "deletion_reason": "Voter reported coerced vote, requested removal",
        "is_manual": false,
        "manual_batch_id": null
      }
    ],
    "paper_batch_count": 0
  }
}
```

- **`candidate_id` is `null` on an anonymous election** _(since 2026-09-30)_.
  Together with a pre-fix `vote_cast` audit row it joined a voter to their
  choice.
- **Voided paper batches** void one row per tallied ballot; `manual_batch_id`
  groups them and `paper_batch_count` counts batches, so a batch reads as one
  void rather than N. Batch cards on the election page show who voided a batch,
  when and why (`voided_by` / `voided_at` / `void_reason`, backfilled for
  batches voided before 2026-09-30).
- **A voided voter may vote again.** Since 2026-09-30 the dedup hash is
  cleared on void (and was cleared on rows already voided), so the member's
  next vote is accepted and counted once; it used to fail with a server error
  on both voting routes. Their old receipt now reads "This vote was voided by
  an officer".
- **Known gap — an officer's void breaks the integrity verdict.** The chain
  check drops deleted rows before walking the chain, so a sanctioned void (a
  single vote or a paper batch) makes **Run Check** report "Vote Integrity
  Issue Detected" and the certified PDF print CHAIN_BROKEN, while voiding the
  chain's last vote leaves PASS. Until the chain design records voids, read a
  CHAIN_BROKEN alongside this list: if every gap is an officer's recorded
  void, it is this gap, not tampering (`docs/KNOWN_LIMITATIONS.md`, W50-31).

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

**Guard (since 2026-07):** a closed **anonymous** election that already has
recorded votes cannot be rolled back to open. The anonymity salt is destroyed at
close, so reopening would let members who already voted vote a second time
undetected — the system refuses the rollback and directs the admin to create a
new election. If you see a CLOSED→OPEN rollback on an anonymous election with
votes in older history, treat it as a red flag for exactly this reason.

### Step 8: Examine Token Usage (Anonymous Voting)

```json
{
  "voting_tokens": {
    "total_issued": 30,
    "total_used": 25,
    "total_superseded": 3,
    "total_expired": 0,
    "total_live": 2,
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

**Issued = used + superseded + expired + live** _(since 2026-09-30)_. A
reminder supersedes the member's earlier unused link (`superseded_at`) once the
new email is confirmed handed to the mail server; a superseded link answers
"This link was replaced by a newer ballot email". "Unused" alone used to lump
these together, and the forensics and results counters disagreed. On a named
(non-anonymous) election, token votes now list their vote ids here.

**Notes on token data (since 2026-07):**

- Tokens issued via **"send test ballot"** are flagged `is_test`; votes cast with
  them are stored `is_test` and excluded from results, stats, and rosters. When
  reconciling counts, remember test votes appear in the raw `votes` table but
  not in any tally.
- Each token stores the **ballot items its voter was eligible for** at issue
  time (`eligible_item_ids`), and submissions are validated against that
  snapshot — so a vote on a restricted item cannot appear even from a valid
  token. A `NULL` snapshot means a legacy token issued before this feature.

---

## Common Investigation Scenarios

### Scenario: "The vote count doesn't match what we expected"

1. Pull forensics report
2. Check `deleted_votes.count` — were any votes removed?
3. Check `vote_integrity` — were any votes tampered with?
4. Compare `voting_tokens.total_issued` vs `total_used` — any unaccounted tokens?

### Scenario: "We suspect someone voted twice"

> **Check the upgrade date first.** On a named election, an in-app vote and a
> vote from the member's emailed link were not recognised as duplicates before
> the 2026-09-30 release, and on a ballot-item election that was open across
> the upgrade a member who voted in-app before it could vote once more after
> it. Both counted. `docs/UPGRADING.md` told operators to close open elections
> first; if one was left open, a double vote there is this, not tampering.

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
- The salt (`voter_anonymity_salt`) is destroyed automatically when the election closes, making de-anonymization **permanently impossible**
- Per-vote **IP addresses and user-agents are purged at close** as well (since 2026-07) — they exist only while voting is open, for live fraud detection
- The **audit log records no voter IPs** for anonymous elections (since 2026-07) — audit rows are hash-chained and can never be scrubbed, so voter-action events omit the IP at write time (rows written before that change retain theirs)
- Voting tokens are stored as **SHA-256 hashes** (since 2026-07) — database read access never yields a live ballot credential, and the raw token travels only in the emailed link's URL fragment (never sent to any server)
- Even with the salt, recovering voter identity requires access to both the salt and user IDs, plus the hashing algorithm

---

## Environment Configuration

| Variable           | Purpose                      | Default                                       |
| ------------------ | ---------------------------- | --------------------------------------------- |
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

`reason` is required (3–500 characters; an empty one is refused with 422), and
the vote must belong to the election in the path — since 2026-09-30, when the
route ignored the path's election and accepted an empty reason.

**Response:**

```json
{
  "message": "Vote soft-deleted successfully",
  "vote_id": "..."
}
```

### `GET /elections/{id}/verify-receipt?receipt=...`

**Permission:** Public (rate-limited)

Voters receive their receipt hash(es) when they submit a ballot. This endpoint
confirms a receipt maps to a recorded vote without revealing its content:

```json
{
  "verified": true,
  "counted": true,
  "voided": false,
  "message": "Your vote has been recorded and is counted",
  "voted_at": "2026-02-10T09:15:00Z",
  "position": "Chief"
}
```

_(Corrected 2026-10-04: the response field is `verified`; this example used to show `valid`.)_ The
other answers:

| Case                 | `verified` | `counted` | `voided` | `message`                                                                                 |
| -------------------- | ---------- | --------- | -------- | ----------------------------------------------------------------------------------------- |
| No such receipt      | false      | false     | false    | "No matching vote found for this receipt"                                                 |
| Voided by an officer | false      | false     | true     | "This vote was voided by an officer" (since 2026-09-30; it read "No matching vote found") |
| Test-ballot vote     | true       | false     | false    | "This was a test vote. It was recorded but is not counted toward the election results."   |

Receipts are shown by the emailed ballot's confirmation screen; the in-app
**Cast Vote** tab does not show one.

Useful in disputes: a voter who saved their receipt can prove their vote was
recorded (or expose that it wasn't) without anyone learning who they voted for.

---

## Audit Event Reference

All election events are logged to the tamper-proof `audit_logs` table with `event_category = "elections"`.

| Event Type                                                              | When                                     | Data Included                                                                        |
| ----------------------------------------------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------ |
| `election_created`                                                      | Election created                         | ID, title, type, voting method                                                       |
| `election_opened`                                                       | Voting opened                            | ID, title, candidate count                                                           |
| `election_closed`                                                       | Voting closed                            | ID, title                                                                            |
| `election_deleted`                                                      | Election deleted                         | ID, title                                                                            |
| `election_rollback`                                                     | Status rolled back                       | ID, from/to status, reason                                                           |
| `vote_cast`                                                             | Authenticated vote                       | Election ID, vote ID, position                                                       |
| `vote_cast_token`                                                       | Anonymous token vote                     | Election ID, vote ID, position                                                       |
| `vote_double_attempt`                                                   | Double-vote blocked (auth)               | Election ID, position                                                                |
| `vote_double_attempt_token`                                             | Double-vote blocked (token)              | Election ID, position                                                                |
| `vote_soft_deleted`                                                     | Vote removed by admin                    | Vote ID, election ID, reason                                                         |
| `vote_integrity_check`                                                  | Integrity verification run               | Total, valid, tampered count                                                         |
| `ballot_emails_sent`                                                    | Email ballots distributed                | Election ID, success/failed counts                                                   |
| `runoff_election_created`                                               | Automatic runoff                         | Parent and runoff election IDs                                                       |
| `forensics_report_generated`                                            | Forensics report pulled                  | Election ID                                                                          |
| `pre_meeting_package_sent`                                              | Pre-meeting package emailed              | Election ID, recipient count, roster variant                                         |
| `pre_meeting_package_downloaded`                                        | Package PDF downloaded                   | Election ID, variant                                                                 |
| `nominations_opened` / `nominations_closed` / `nominations_auto_closed` | Nomination phase transitions             | Election ID (deadline for auto-close)                                                |
| `candidate_nominated`                                                   | A member nominated (self or third-party) | Election ID, position, nominee, nominator                                            |
| `nomination_accepted` / `nomination_declined`                           | Nominee responded                        | Election ID, candidate ID (declines keep the record here after the entry is removed) |
| `election_auto_opened` / `election_auto_closed`                         | Lifecycle task transition                | Election ID                                                                          |
| `election_reminder_sent`                                                | Non-voter reminder ballots sent          | Election ID, recipient count                                                         |
| `election_manual_ballots_recorded`                                      | Paper tally recorded                     | Election ID, batch ID, vote count (warning severity when over-count override used)   |
| `election_manual_ballots_attested`                                      | Officer attested a paper batch           | Election ID, batch ID, attesting officer                                             |
| `election_manual_ballots_voided`                                        | Paper batch voided                       | Election ID, batch ID, reason                                                        |
| `election_manual_ballots_unattested_at_close`                           | Close with a pending batch               | Election ID, batch ID (votes excluded from results)                                  |
| `election_tie_detected`                                                 | Tie under a non-co-winners policy        | Election ID, position, tied candidates                                               |
| `election_write_ins_merged`                                             | Write-in variants consolidated           | Election ID, merged candidate IDs, target                                            |
| `election_cloned`                                                       | Draft cloned from an election            | Source and new election IDs                                                          |
| `printable_ballot_downloaded`                                           | Blank paper ballot PDF generated         | Election ID                                                                          |
| `certified_results_downloaded`                                          | Certified results package generated      | Election ID                                                                          |
