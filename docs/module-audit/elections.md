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

### ELEC-3 — MEDIUM — Vote-dedup hash breaks approval / multi-vote-per-position — ✅ FIXED
`_compute_vote_dedup_hash = SHA256(election_id:voter:position)` **excluded
`candidate_id`** and the column is UNIQUE. For `voting_method="approval"` or
`max_votes_per_position > 1`, a voter's legitimate second vote for the same
position collided → `IntegrityError` → rejected. The app-level checks in
`cast_vote` (blanket "already voted for this position") and the non-positional
short-circuit in `check_voter_eligibility` also blocked the second vote, so
approval and ranked-choice voting were broken at both layers.
**Fix (2026-07 review):** `_compute_vote_dedup_hash` takes an optional
`discriminator` — `rank:<n>` for ranked choice, `cand:<id>` for
approval/multi-vote, `""` for single-vote (byte-identical to the legacy hash,
so existing rows keep their protection). `cast_vote`'s duplicate checks are now
method-aware (duplicate rank / duplicate candidate rejected;
`max_votes_per_position` honored), and the eligibility short-circuit only
applies to single-vote methods. The authenticated bulk endpoint was reworked to
a typed `BulkVoteItem` payload and true atomicity (`cast_vote(commit=False)` +
one commit; the old savepoint was broken because `cast_vote` committed
internally), and `ElectionBallot.tsx` now submits ranked/approval votes through
it in one call instead of a non-atomic sequential loop.

### ELEC-4 — MEDIUM — `rollback_election` (CLOSED→OPEN) enables double-voting — ✅ FIXED (guard)
`close_election` destroys `voter_anonymity_salt`, but `rollback_election` could
reopen a closed election. After reopen the salt is `None`, so `_generate_voter_hash`
yields a *different* hash than the original votes — a voter who already voted is
no longer matched by `has_voted`, and their new `vote_dedup_hash` differs, so
they could vote **again**.
**Fix (2026-07 review):** CLOSED→OPEN rollback is now refused for anonymous
elections whose salt is destroyed **and** that have recorded votes (clear error
directs the admin to create a new election). Rollback with zero votes still
works. This is a deliberate behavior change: the refused case is exactly the
unsafe one. The alternative (retaining the salt post-close) would weaken
SEC-12 and was rejected.

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

### ELEC-8 — LOW — `verify_vote_receipt` is unusable (receipt never returned) — ✅ FIXED
`_compute_receipt_hash` stored a receipt, but no voting response returned it,
so the public `GET /{election_id}/verify-receipt` could never be satisfied.
**Fix (2026-07 review):** `submit_ballot_with_token` returns `receipt_hashes`
(added to `BallotSubmissionResponse`) and the single token-vote response now
includes `receipt_hash`. The frontend receipt block in `BallotVotingPage`
renders them; verify-receipt is now usable end-to-end.

### ELEC-9 — LOW / dead code — unreachable max-votes branch in `cast_vote_with_token` — ✅ FIXED
Removed together with the ELEC-3 rework; the same change also fixed the
`position=None` filter degrading to a no-op (see R-8 below).

## 2026-07 follow-up review (R-findings)

A second full review of the elections feature (creation, ballots, runoffs,
results, eligibility) found the following beyond ELEC-1…ELEC-9. All fixed in
the same change unless marked deferred. Migration `20260730_0001` adds
`voting_tokens.is_test` and `voting_tokens.eligible_item_ids`.

### Fixed

- **R-1 — HIGH — Token ballots never enforced per-item eligibility.**
  `eligible_voter_types` / `require_attendance` were only checked at
  email-send time; any token holder could vote on restricted items (e.g.
  life-member-only bylaw votes) by POSTing their ids. Tokens carry no user
  identity (only a one-way `voter_hash`), so the eligible item set is now
  snapshotted on the token at send time (`eligible_item_ids`) and enforced in
  `submit_ballot_with_token` (non-abstain votes on ineligible items rejected);
  `GET /ballot` also filters the returned items. `NULL` = legacy token,
  unrestricted — fail-open is time-bounded by token expiry. The authenticated
  path had a sibling hole: `cast_vote` called `check_voter_eligibility`
  without `position`, so per-position/per-item checks never fired — it now
  passes the position.
- **R-2 — HIGH — Public `GET /ballot` leaked the member roster.** It returned
  the full `ElectionResponse` — `attendees` (names + who checked them in),
  `eligible_voters`, `email_recipients`, `created_by` — to any token holder.
  Now returns the minimal `BallotElectionResponse` (only what the voting page
  renders).
- **R-3 — HIGH — "Test ballots" cast real, counted votes.** `Vote.is_test`
  was never set anywhere; `send-test-ballot` issued a normal token, so test
  votes counted in results and consumed the manager's dedup slot.
  `VotingToken.is_test` is now threaded from `send-test-ballot` through
  `send_ballot_emails` → `_generate_voting_token`; both token vote paths stamp
  `Vote.is_test` and namespace the dedup input (`test:<hash>`) so a test vote
  never blocks the member's real one.
- **R-4 — HIGH — Early close silently skipped runoffs.**
  `_check_and_create_runoff` called `get_election_results` without
  `_internal_bypass_visibility=True`; the visibility gate requires
  `now > end_date`, so closing before the scheduled end (the normal
  end-of-meeting flow) returned `None` and no runoff was created. Bypass flag
  added.
- **R-5 — MEDIUM — `attendees` was client-settable at creation.**
  `ElectionBase.attendees` flowed into `Election(**data)` unvalidated,
  letting a manager fabricate check-ins that feed `require_attendance`
  eligibility. Removed from the create/update schema; check-ins must go
  through the audited `POST /{id}/attendees` / import endpoints.
- **R-6 — MEDIUM — Turnout/quorum denominator counted non-voting tiers.**
  Results/stats fell back to *all* active users, so a percentage quorum could
  fail even when 100 % of actually-eligible members voted. New
  `_count_eligible_voters()` excludes tiers with `voting_eligible: false`
  (adding back secretary-override members). Election-level only — per-item
  role/attendance rules are deliberately not modeled in turnout.
- **R-7 — MEDIUM — `preview-ballot` disagreed with the real ballot.** It
  compared raw `membership_type` strings (missing the operational/regular/
  life category semantics of `_user_has_role_type`), ignored voter overrides,
  and only checked attendance when `attendees` was non-empty (fail-open).
  Preview and the real filter now share one source of truth
  (`annotate_ballot_items_for_user`, from which
  `_get_eligible_ballot_items_for_user` is derived).
- **R-8 — MEDIUM — `cast_vote_with_token` no-op filter over-blocked.**
  `.where(Vote.position == position if position else True)` degraded to a
  no-op for positionless votes, so *any* prior vote blocked submission. Now
  matches `Vote.position IS NULL` for positionless votes.
- **R-9 — LOW — Missing `is_test` filters.** Runoff advancement tally,
  `get_election_stats`, and `get_non_voters` counted test votes (results/
  roster already filtered). Filters added; forensics stays inclusive by
  design (investigative view).
- **R-10 — LOW — Frontend fixes.** (a) Non-managers opening an election saw a
  highlighted tab with **no panel** — `ElectionWorkflowTabs` now syncs its
  corrected tab back to the parent. (b) `/elections/settings` route had no
  `ProtectedRoute requiredPermission="elections.manage"` gate (backend was
  gated). (c) Candidate↔ballot-item fallback matching used
  `title.includes(position)` — "Chief" matched "Assistant Chief"; now exact
  match only. (d) `ElectionBallot` compared `voting_method` against
  `VoteType.APPROVAL` instead of `VotingMethod.APPROVAL` (worked by string
  coincidence). (e) `UNCACHEABLE_PREFIXES` used `'/elections/'` so the list
  endpoint `GET /elections` was cached; now `'/elections'`.

### Follow-up fixes (practical-workflow review, 2026-07-28)

- **R-11 — MEDIUM — Runoffs didn't inherit the parent's rule set.**
  `_check_and_create_runoff` built the child election by hand and omitted:
  the **anonymity salt** (anonymous runoffs hashed voters with an empty key —
  pre-computable from user ids, defeating SEC-12 for every runoff round),
  **quorum** (a quorum-required election's runoff had none),
  **position_eligibility** (position-level voter-type limits vanished in the
  deciding round), and the meeting/event link, attendees, and voter
  overrides (electorate context lost). Fixed: runoffs now inherit
  quorum/eligibility/links/overrides and generate a **fresh** salt (never
  the parent's — that one is destroyed at close).
- **R-12 — MEDIUM — Same-meeting runoffs were practically impossible.**
  Runoffs default to `start = now + 1h`; every vote path rejects votes
  before `start_date`; and the UI had no way to edit a draft election's
  dates ("Extend Time" is open-status, end-date-only). Opening the runoff at
  the meeting meant an hour of "Election has not started yet". Fixed twice
  over: `open_election` now clamps a future `start_date` to the open time
  (opening *is* the declaration that voting starts; audited as
  `start_adjusted_to_open_time`) and refuses to open an election whose
  `end_date` already passed; and the detail page has an **Edit Dates**
  modal for draft elections (start + end, quarter-hour granularity,
  15-min/30-min/1-hour/1-day quick durations).

### Open / deferred

- **R-D1 — ELEC-5 remains:** voting tokens are stored in plaintext at rest
  (512-bit entropy is the guessing defense). Fix requires storing a SHA-256
  and an in-flight-token compatibility decision. Docstrings claiming tokens
  are "hashed" were corrected in this change.
- **R-D2 — ELEC-6 remains:** forensics exposes `ip_vote_distribution` and
  per-hour timelines to any `elections.manage` holder — enough to correlate
  voters with anonymous ballots in a small department. Treat forensics as
  break-glass; recommend threshold-only exposure in a follow-up.
- **R-D3 — Ballot token in GET query/path:** `GET /elections/ballot?token=`
  and `GET /elections/ballot/{token}/candidates` put the live credential in
  server/proxy logs and browser history, contradicting the POST-body
  rationale on the vote endpoints. The emailed link itself is `?token=`, so a
  full fix needs a redeem-and-store flow.
- **R-D4 — `position_eligibility` unenforced on the token path** for
  positional (non-ballot-item) elections — R-1 covers ballot-item elections
  only. Mirroring the fix needs eligible positions persisted on the token.
- **R-D5 — Token single-vote limitation:** `cast_vote_with_token` still
  allows only one vote per position, so approval/ranked voting via the
  single-vote token endpoint is not supported (the bulk ballot path and the
  authenticated path are). Acceptable: the ballot UI uses the bulk path.

## Notes
- `check_eligibility` and the vote endpoints use bare `get_current_user`; they
  do their own eligibility/self-scoping (and ELEC-1 closed the enforcement hole).
