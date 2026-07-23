# Module Audit — Elections

**Files:** `app/api/v1/endpoints/elections.py` (2,721 L, 46 endpoints incl. 5
public token endpoints), `app/services/election_service.py` (4,616 L),
`app/services/quorum_service.py` (139 L), model `app/models/election.py`,
frontend `modules/elections`.
**Audited:** iteration 5 (security-critical — voting integrity, ballot secrecy,
token security, tenant isolation, tally/quorum correctness).

## Verified good ✅
- **Voting-token → tenant isolation is sound.** `get_ballot_by_token` loads the
  election from the token's own `election_id`; `cast_vote_with_token` /
  `submit_ballot_with_token` validate `candidate.election_id == election.id` and
  only accept candidate ids from that election's map — no cross-org/cross-election
  vote injection via token. Tokens are 512-bit (`secrets.token_urlsafe(64)`).
- **Token single-use / replay-proof:** `used` flag + DB-unique `vote_dedup_hash`
  block replay and double submission, including under concurrency.
- **Voting window enforced (token path):** expiry + election status + open/close
  dates all checked in `get_ballot_by_token`.
- **Concurrency:** `close_election`/`open_election` use `with_for_update()` to
  avoid duplicate runoffs / double-open.
- **Public endpoints rate-limited:** 10/min reads, 5/min votes, IP lockouts
  (300s/600s), via the proxy-aware `check_rate_limit`.
- **Tally math correct:** quorum uses `ceil - epsilon`; majority uses `n//2 + 1`.
- **No SQL injection:** the `.format()` hits are email templates (internal
  constants, all user fields `html.escape`'d), not SQL. Write-in names escaped.
- **Auth scoping (authenticated endpoints):** `get_election`,
  `check_voter_eligibility`, `cast_vote`, `cast_proxy_vote`, override/proxy/
  results/stats/forensics/roster paths all filter `Election.organization_id` —
  except the two candidate endpoints fixed below.

## Findings

### ELEC-1 — HIGH — `cast_vote` ignored `eligibility.is_eligible` (auth voting bypass) — ✅ FIXED
`cast_vote` computed `check_voter_eligibility(...)` but only read
`positions_voted`/`has_voted` — it **never checked `is_eligible`** and did no
independent status/date check. Any authenticated org member hitting
`POST /{election_id}/vote` (or `/vote/bulk`, both gated only by
`get_current_user`) could therefore vote in a DRAFT/CLOSED/CANCELLED election,
before `start_date` / after `end_date`, or while not on a restricted
`eligible_voters` list, and bypass membership-tier/attendance rules. The token
path (`get_ballot_by_token`) and `cast_proxy_vote` both gate correctly — this
was the lone outlier.
**Fix:** added `if not eligibility.is_eligible: return None, eligibility.reason`
immediately after the eligibility computation, mirroring `cast_proxy_vote`.
Verified against the test fixtures (open election + eligible members ⇒ gate
passes, happy path unchanged).

### ELEC-2 — HIGH/MEDIUM — Cross-tenant IDOR in `update_candidate` / `delete_candidate` — ✅ FIXED
Both endpoints fetched the candidate by `(id, election_id)` — both
attacker-controlled path params — with **no `organization_id` scoping**.
`require_permission("elections.manage")` only asserts the permission in the
caller's own org, not on the target, so an org-A admin could edit/delete an
org-B candidate given the two UUIDs. `create_candidate` does it correctly via
`get_election(..., organization_id)`.
**Fix:** added the same `get_election(election_id, current_user.organization_id)`
ownership check (404 on miss) at the top of both endpoints before the candidate
fetch.

### ELEC-3 — MEDIUM — Vote-dedup hash breaks approval / multi-vote-per-position
`_compute_vote_dedup_hash = SHA256(election_id:voter:position)` **excludes
`candidate_id`** and the column is UNIQUE. For `voting_method="approval"` or
`max_votes_per_position > 1`, a voter's legitimate second vote for the same
position collides → `IntegrityError` → rejected. So `max_votes_per_position`
can never exceed 1 in practice; approval voting is silently broken.
**Status:** flagged — the fix is conditional (include `candidate_id` in the
hash for approval/multi-vote elections, keep excluding it for single-vote) and
must not weaken single-vote dedup, so it needs design + tests. Not auto-applied.

### ELEC-4 — MEDIUM — `rollback_election` (CLOSED→OPEN) enables double-voting
`close_election` destroys `voter_anonymity_salt`, but `rollback_election` can
reopen a closed election. After reopen the salt is `None`, so `_generate_voter_hash`
yields a *different* hash than the original votes — a voter who already voted is
no longer matched by `has_voted`, and their new `vote_dedup_hash` differs, so
they can vote **again**. Same salt loss makes `get_non_voters`/roster mis-report
everyone as a non-voter post-close.
**Status:** flagged — needs a design decision (preserve the salt, or forbid
rollback once the salt is destroyed). Behavior change; not auto-applied.

### ELEC-5 — MEDIUM — Voting tokens stored/compared in plaintext (contradicts "hashed" docs)
`_generate_voting_token` stores the raw `token_urlsafe(64)` and
`get_ballot_by_token` looks it up with `VotingToken.token == token` — plaintext
equality, not a hash lookup. Entropy (512-bit) makes guessing impractical, but
the model + endpoint docstrings claim the token is "hashed," and anyone with
read access to `voting_tokens` obtains live ballot credentials.
**Status:** flagged — real fix is to store only a SHA-256 of the token and look
up by that (migration + code change). Left for deliberate work; the docstrings
should be corrected in the same change to stop over-claiming.

### ELEC-6 — MEDIUM — Ballot secrecy holds only against non-DB actors, only after close
For anonymous elections each `Vote` still stores `voter_hash` (deterministic
HMAC keyed by a salt in the *same* `elections` row) plus `ip_address` and
`user_agent`. Until `close_election` nulls the salt, anyone with DB read access
can recompute every member's hash and map `voter_hash → candidate_id`;
`get_election_forensics` further exposes per-IP distributions and proxy→delegator
maps to any `elections.manage` admin.
**Status:** flagged (documented limitation) — recommend minimizing stored
IP/user-agent for anonymous elections and treating forensics as break-glass.

### ELEC-7 — LOW — `create_candidate` stores client-supplied `user_id` unvalidated (XC-1)
`Candidate(..., **candidate.model_dump())` persists `user_id` with no in-org
check. Same low-severity pattern tracked in CROSS-CUTTING XC-1.

### ELEC-8 — LOW — `verify_vote_receipt` is unusable (receipt never returned)
`_compute_receipt_hash` stores a receipt, but no voting response returns it
(`cast_vote_with_token`/`submit_ballot_with_token` omit it), so the public
`GET /{election_id}/verify-receipt` can never be satisfied. The endpoint itself
is safe (unguessable receipt, returns only `voted_at`+`position`, no identity).
**Status:** flagged — feature completion (return `receipt_hash` to the voter +
schema/frontend change), not a bug fix.

### ELEC-9 — LOW / dead code — unreachable max-votes branch in `cast_vote_with_token`
The function returns early whenever `existing_votes` is non-empty, so the later
`position_votes` filter is always empty and its branch is dead. Harmless, but
tied to the ELEC-3 multi-vote design gap — left in place until ELEC-3 is
resolved (removing it in isolation would obscure that gap).

## Notes
- `check_eligibility` and the vote endpoints use bare `get_current_user`; they
  do their own eligibility/self-scoping (and ELEC-1 closed the enforcement hole).
