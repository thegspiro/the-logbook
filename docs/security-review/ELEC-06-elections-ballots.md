# Security Review 06 — Elections & Ballots

**Prefix:** `ELEC` · **Iteration:** 06 · **Reviewed:** 2026-08-25 (pass 1), 2026-08-27 (pass 2), 2026-09-02 (pass 3) · **PR:** [#1810](https://github.com/thegspiro/the-logbook/pull/1810) (pass 1), [#1948](https://github.com/thegspiro/the-logbook/pull/1948) (pass 2), [#2162](https://github.com/thegspiro/the-logbook/pull/2162) (pass 3)

---

## Pass 3 (2026-09-02)

**Scoping, done the way FIN-05 pass 3 documented it is necessary:** this
repo's history has been rewritten more than once since pass 2 merged, so
pass 2's own PR head is not an ancestor of `origin/main` by commit hash.
The real landing point is identified by content match instead —
`a518957e5` (`fix(elections): fix quorum staleness, public-ballot 401s, and
a mislabeled option (Codex on #1948)`) is the commit whose diff is pass 2's
own fix set verbatim (the `populate_existing=True` line in
`quorum_service.py`, the `get_optional_current_user` exception handling in
the module gate, the corrected `BallotBuilder.tsx` label), and
`git merge-base --is-ancestor a518957e5 origin/main` confirms it is an
ancestor of the current head. (The working clone started shallow; unshallowed
to `git log` past it rather than trusting a blame boundary commit.)

**Diffed from there — zero change in the core module:**
`backend/app/api/v1/endpoints/elections.py`,
`backend/app/services/election_service.py`,
`backend/app/services/quorum_service.py`, `backend/app/models/election.py`,
and `backend/app/schemas/election.py` are all byte-identical to their state
at `a518957e5` (`git diff --stat a518957e5..origin/main -- <these 5 files>`
returns nothing). 55 migrations landed since then; none touch an election
table by content (checked every migration's body, not just its filename, per
pass 2's own established method) — the one hit,
`20260901_1320_f7b3c8d2e569_restore_seeded_position_grants.py`, only lists
`elections.view`/`elections.manage` among the many permission strings a
cross-cutting onboarding-wizard fix restores across every module; it is not
an elections-specific change. No frontend file under `frontend/src/`
mentioning `ballot`/`election`/`quorum` (word-bounded, not a substring match —
substring matching on "election" over-matches on words like "selection")
changed either, beyond a handful of cross-cutting files (navigation, the QA
`testingRegistry`, onboarding's module-name lists, `apiCache`'s
`UNCACHEABLE_PREFIXES`) whose diffs, checked line by line, touch unrelated
modules and only incidentally list `'elections'` as one module name among
several — not an elections-specific behavior change.

**Given zero code change, this pass re-verified rather than re-derived —
enumerating routes and sampling code paths pass 1/2 did not read in the
depth applied here, not re-reading everything:**

- **Route inventory re-confirmed exactly: 65 routes, 56
  `require_permission`, 5 authenticated-only, 4 public**
  (`grep -c "Depends(require_permission" / "Depends(get_current_user)" /
"^@router\."` — 56 / 5 / 65, matching the documented 56+5+4 split exactly).
  Every `require_permission` call is single-argument (`"elections.view"` or
  `"elections.manage"`) — no OR-gate multi-permission call exists in this
  module for the CLAUDE.md Pitfall #23 class of risk to apply to.
- **Baseline-grant check (checklist §2, not previously called out by name in
  this file): clean.** `DEFAULT_POSITIONS["member"]`
  (`app/core/permissions.py:2135`) carries `ELECTIONS_VIEW` and nothing else
  from this module — matches the module's own design (every member may
  attempt to vote; the 5 self-scoped routes do their own eligibility check).
  `elections.manage` is not in any baseline grant (`member` or the
  `firefighter` rank's `default_permissions`).
- **Manual-ballot-batch surface (`attest_manual_ballot_batch`,
  `void_manual_ballot_batch`, `list_manual_ballot_batches`,
  `election_service.py:3502-3766`) read in full — not previously singled out
  by name in this file's Verified-good list.** Both mutating paths take
  `.with_for_update()` on `ManualBallotBatch` (attest) or resolve `Vote`
  through a `.join(Election).where(Election.organization_id == ...)` (void),
  both re-check `organization_id` on every fetch, and the separation-of-duties
  rule (`checklist §2` — "the reviewer cannot be the subject") is enforced in
  code: `attest_manual_ballot_batch` refuses when
  `attested_by == batch.recorded_by`. The one non-org-filtered query in this
  block (`select(User.id, ...).where(User.id.in_(list(user_ids)))` in
  `list_manual_ballot_batches`, resolving display names) is not an IDOR
  vector — `user_ids` is built entirely from `recorded_by`/`attested_by`
  columns on rows already scoped to the caller's org, not from any
  client-supplied id.
- **The 4 public token routes re-read against their compensating controls,
  full route bodies not just descriptions** (`lookup_ballot_by_token`,
  `cast_vote_with_token`, `submit_ballot_with_token`, `verify_vote_receipt`,
  `elections.py:508-723`, `3775-3809`) — rate-limited via
  `_ballot_read_rate_limit`/`_ballot_vote_rate_limit`,
  `eligible_item_ids`/`eligible_positions` snapshot filtering present,
  receipt lookup returns no PII beyond `voted_at`/`position`. **Corrected on
  Codex review (ELEC-14 below): the claim that the token "never [travels as]
  a URL query param" does not hold for all four** — `verify_vote_receipt`
  declares `receipt: str` as a bare GET query parameter, so that one
  credential does land in the URL. See ELEC-14 for the accurate per-route
  breakdown and disposition.
- **ELEC-12 re-verified still accurate and still open** — see below.
- **No `.like()`/`.ilike()` anywhere in the module** (still zero, re-grepped).
  No `csv.writer`/`SafeCsvWriter` call in the module — elections has no CSV
  export, so Pitfall #15 is still n/a here, not overlooked.
- **10 `.with_for_update()` sites, re-enumerated**
  (`election_service.py:1110,1352,2992,3048,3286,3527,4413,4667,7118,7128`) —
  consistent with the locking pass 1/2 already documented (open/close
  election, quorum calc, token consumption, manual-ballot attestation).
  **Corrected on Codex review: "no new capacity/race surface" did not hold.**
  Re-enumerating the count wasn't the same as tracing whether each lock's
  _read_ was also a locking read (Pitfall #27's second half) or whether a
  lock on one row actually serialized against every other transaction that
  matters to it — three of these ten sites had exactly that gap (ELEC-15,
  ELEC-17, ELEC-18 below), latent in code this pass's own diff showed as
  byte-identical to pass 2, i.e. present since at least pass 2 and missed by
  it too.

**Codex review on this PR raised 8 findings against this pass's initial
"0 fixes, 0 new findings" write-up. Each was independently re-traced against
current code (not taken on either the original pass's or Codex's word) per
`AGENTS.md`'s "inspect the current implementation" standard — 6 confirmed
real and fixed, 2 confirmed real and flagged (a product/API-contract
decision in each case, not a mechanical fix).** ELEC-12 remains open
unchanged; see below. New findings below are numbered ELEC-13 onward,
continuing this module's series.

### ELEC-13 — P2 — Custom membership tier inherited a stale operational/regular class for restricted ballots — ✅ FIXED

**What:** `6b5a82fa` (landed between pass 2 and this PR, in the same commit
range this pass's diff otherwise found byte-identical to pass 2 — the diff
check compared against `a518957e5`, pass 2's own landing commit, and never
re-diffed against anything later, so this change was missed rather than
ruled out) changed `models/user.py::_reconcile_membership` to _preserve_
`member_class`/`member_status` from before a member is moved onto an
org-configured custom membership tier (e.g. `"senior"`), instead of nulling
them the way it did when pass 2 documented `split_membership_type`'s
"a custom tier matches no built-in category" guarantee. That change was
correct for its own purpose (`ShiftEligibilityService` needs to keep
recognizing that a senior-tier member still rides — see the commit message)
— but `ElectionService._user_has_role_type` (`election_service.py:250`)
reads the exact same two columns for ballot-eligibility categories
(`operational`, `regular`, `administrative`, …), with no awareness that the
value it's trusting may be a carryover from before a tier switch rather than
the member's current standing.

**Where:** `election_service.py:281-296` (pre-fix).

**Failure scenario:** a regular operational firefighter is moved onto a
department's custom `"senior"` membership tier (a real, department-
configured tier, not a hypothetical one — the shipped defaults include it).
`_reconcile_membership` preserves `member_class="operational"`,
`member_status="regular"` on the row. A ballot item restricted to
`eligible_voter_types: ["operational"]` (e.g. an operations-only vote on
apparatus purchase) then still counted this member as eligible, even though
`split_membership_type`'s own docstring — quoted and relied on by pass 2 —
states a custom tier is supposed to match no built-in category, precisely to
avoid widening a restricted ballot's electorate.

**Fix:** `_user_has_role_type` now checks the member's _live_
`membership_type` first. When it resolves (via `split_membership_type`) to
`(None, None)` — the signature of an unrecognized, org-configured tier — the
cached `member_class`/`member_status` are discarded for eligibility purposes
regardless of what shift eligibility keeps them for, restoring the documented
"a custom tier matches nothing" invariant. A recognized legacy
`membership_type` (`"active"`, `"life"`, …) is unaffected; so is a caller
passing a bare class/status stub with no `membership_type` at all (existing
unit tests). Guarded by
`TestCustomTierDoesNotInheritStaleEligibility` (`test_election_codex_round2.py`),
confirmed to fail pre-fix via `git stash`.

### ELEC-14 — P2 — `verify_vote_receipt`'s credential is a GET query parameter, not body/fragment — 🚩 FLAGGED (doc corrected)

**What:** `verify_vote_receipt` (`elections.py:3775` pre-fix numbering,
`GET /{election_id}/verify-receipt`) declares `receipt: str` as a bare
scalar path/query parameter on a `@router.get` route, so FastAPI binds it
from `?receipt=...`. This pass's first draft asserted all 4 public token
routes carry their credential "in body/fragment, never a URL query param" —
true for `/ballot/lookup`, `/ballot/vote`, and `/ballot/vote/bulk` (all
`POST` with the token in the request body), false for this one. Pass 1's own
route table (`## Route inventory`, above) already had this right — "receipt
hash is the credential" with no body/fragment claim — so the error was
introduced by this pass's own summary sentence, not inherited.

**Impact:** the receipt hash is not a voting credential — it cannot cast,
change, or reveal the content of any vote, only confirm that _a_ vote
matching it was recorded, plus its timestamp and position
(`VoteReceiptResponse`) — but it will appear in query strings, which
commonly land in nginx/reverse-proxy access logs and browser devtools
network history, unlike a POST body.

**Fix:** not applied. Converting this to a `POST` with the receipt in the
body (mirroring `/ballot/lookup`'s R-D3 pattern) is a public API **shape**
change, not a mechanical one: this exact `GET .../verify-receipt?receipt=`
contract is documented as a stable, external-facing endpoint across
`wiki/API-Reference.md`, `ARCHITECTURE.md`, `BALLOT_FORENSICS_GUIDE.md`, and
the training materials, any of which may already have a caller depending on
the GET shape. Changing it is a decision for whoever owns that external
contract, not something to guess at on a security-review pass — the same
standard ELEC-12 was held to. The documentation's overreaching claim is
corrected above; the transport tradeoff itself is mirrored to
`docs/KNOWN_LIMITATIONS.md`.

### ELEC-15 — P1 — Attestation could race a concurrent close — ✅ FIXED

**What:** `attest_manual_ballot_batch` took a `.with_for_update()` lock on
the `ManualBallotBatch` row, then read `Election.status` with a **plain**
(non-locking) `select`. `close_election` locks and commits the `Election`
row independently, and the two locks don't block each other — they're on
different rows. Under REPEATABLE READ, the plain election read is not
guaranteed to reflect a commit that happened after this transaction's
snapshot was established, so an attestation that started just before a
concurrent close could still observe `status == OPEN`, pass the
"attestations can only be added while voting is open" check, and commit a
batch to `"confirmed"` after the election had already closed and generated
its certified results (which had, at that moment, correctly excluded the
still-pending batch and logged it as such) — leaving the closed election's
audit trail saying "excluded" while a later results view would show the
batch's votes counted.

**Where:** `election_service.py:3562-3567` (pre-fix: plain `select`, no
`.with_for_update()`).

**Fix:** the election read in `attest_manual_ballot_batch` now takes
`.with_for_update()` too. `close_election` never locks the batch, so there
is no lock-ordering deadlock risk in adding this. Guarded by
`TestAttestationLocksElection` (`test_election_codex_round2.py`), confirmed
to fail pre-fix via `git stash`.

### ELEC-16 — P2 — `list_manual_ballot_batches` is unbounded — 🚩 FLAGGED

**What:** `list_manual_ballot_batches` (`election_service.py:3617`) runs
`scalars().all()` over every `ManualBallotBatch` for the election with no
pagination, eager-loads every attestation (`selectinload`), and aggregates
every associated vote via a separate unbounded query — the same
no-`all()`-over-an-org-scale-table shape as ELEC-12. `record_manual_ballots`
places no cap on how many batches an election can accumulate, and its
audited `allow_over_count` option does not gate batch creation, only the
aggregate voter-count check within one batch.

**Impact:** access control is sound (`elections.manage`-gated, org- and
election-scoped, same trust boundary as `SavedBallotTemplate`), so — as with
ELEC-12 — this is a scaling concern rather than a leak: a long-lived
election with many recorded paper-tally sessions pays a growing,
un-capped cost on every load of this listing.

**Fix:** not applied, for the identical reason ELEC-12 was flagged rather
than fixed: pagination changes this endpoint's response envelope (a
frontend-affecting contract change), and a creation cap needs a number
picked by a human, not inferred by a review pass. Mirrored to
`docs/KNOWN_LIMITATIONS.md` alongside ELEC-12.

### ELEC-17 — P1 — Token-submission lock didn't refresh already-cached election/token state — ✅ FIXED

**What:** `get_ballot_by_token` loads the `Election` and `VotingToken` ORM
objects into the session's identity map (and commits, updating the token's
access counter). `_lock_token_ballot_for_submission` then re-`SELECT`s the
_same_ primary keys `.with_for_update()` to serialize the actual vote write.
With `expire_on_commit=False` (`core/database.py`), SQLAlchemy's default
behavior on a re-`SELECT` for a row already in the identity map is to return
the **cached Python object without copying the new row's columns onto it** —
the row lock is genuinely acquired at the SQL level, but
`locked_token.used` / `locked_election.status` still read whatever was
in memory before the lock was taken. A concurrent submission or close that
committed while this request was waiting for the lock would then be
invisible to it: the exact same class of bug this module's own pass 2 found
and fixed in `quorum_service.py::calculate_quorum` (`populate_existing=True`
on the locking re-select), present here in the token path and undetected by
either pass 1 or pass 2's review of it.

**Where:** `election_service.py:7143-7155` (pre-fix: `.with_for_update()`
with no `.execution_options(populate_existing=True)`).

**Fix:** both re-selects (election and token) now add
`.execution_options(populate_existing=True)`, matching the established
lock-and-repopulate pattern (`quorum_service.py`,
`membership_pipeline_service.py`, `inventory_service.py`). Guarded by
`TestTokenLockRepopulatesExisting` (`test_election_codex_round2.py`),
confirmed to fail pre-fix via `git stash`.

### ELEC-18 — P2 — Voiding a manual-ballot batch was not row-locked — ✅ FIXED

**What:** `void_manual_ballot_batch` ran plain (non-locking) selects of both
`ManualBallotBatch` and `Vote`, and had no check for a batch already voided.
Two officers voiding the same still-pending batch concurrently could both
load the same not-yet-voided rows before either committed, both succeed and
both audit-log a success, with the later ORM flush silently overwriting the
first officer's `deleted_by`/`deletion_reason`/`deleted_at` — corrupting the
exact forensic attribution this operation exists to preserve. This pass's
initial write-up called the "manual-ballot-batch surface" row-locked as a
group without re-checking this specific method's queries against that claim.

**Where:** `election_service.py:3746-3775` (pre-fix: no `.with_for_update()`
on either query, no already-voided guard).

**Fix:** locks the batch row first (`.with_for_update()`) — the parent every
void of this batch contends on — and returns early with "This batch has
already been voided" if a concurrent void already committed. The vote select
is also `.with_for_update()`. Two concurrent voids now serialize on the
batch lock; the loser sees the committed `"voided"` status and never
re-processes the votes. Guarded by `TestVoidManualBallotBatchLocking`
(`test_election_codex_round2.py`), confirmed to fail pre-fix via `git stash`.

### ELEC-20 — P1 — A candidate-selection ballot item's single-choice vote wasn't bound to its own item — ✅ FIXED

**What:** in `submit_ballot_with_token`, the `rankings` and `candidate_ids`
payload forms both verify `candidate.position == position` (the _current_
ballot item's effective position) before accepting a selection. The plain
UUID `choice` form — used for a simple single-candidate selection — checked
only `choice in candidate_map`, i.e. that the candidate exists _somewhere_ in
the election, not that it belongs to the ballot item named in this vote
entry.

**Where:** `election_service.py:7770-7777` (pre-fix).

**Failure scenario:** an election with two candidate-selection ballot items,
A and B. A crafted `POST /ballot/vote/bulk` submission sends
`{"ballot_item_id": "item_b", "choice": "<item A's candidate id>"}`.
Pre-fix, this passed the existence check, and `_create_token_vote` stored
the vote with `candidate_id` = item A's candidate and `position` = item B's
effective position — binding a candidate onto a contest they were never
nominated for.

**Fix:** the `choice`-as-candidate-UUID branch now checks
`candidate.position == position`, matching the other two branches exactly.
Guarded by `TestSubmitBallotChoiceBoundToItem` (`test_election_codex_round2.py`,
plus a same-item positive-path test), confirmed to fail pre-fix via
`git stash`.

### ELEC-21 — P1 — Single-vote token route (`/ballot/vote`) skipped per-item eligibility — ✅ FIXED

**What:** `cast_vote_with_token` (the single-vote route) checked only
`voting_token.eligible_positions`. That field is populated **only** for
positional (non-ballot-item) elections —
`generate_and_send_election_report`'s own snapshot logic (`election_service.py:5983-5989`)
sets it `if not election.ballot_items and election.positions and
election.position_eligibility`, so for a ballot-item election it is always
`None`. `eligible_item_ids` — the field that actually restricts a
ballot-item voter — was never checked by this route at all, even though the
bulk route (`submit_ballot_with_token`) already enforced it. This is the
reintroduction (via a route that didn't exist, or wasn't checked, when R-1
was originally fixed) of the exact class of bug R-1 closed: a token scoped
to a subset of items could vote on an item outside that scope.

**Where:** `election_service.py:7256-7270` (pre-fix — `eligible_positions`
check only, no `eligible_item_ids` check anywhere in the function).

**Failure scenario:** an election has two ballot items, one open to
everyone and one restricted (e.g. to `["operational"]`). A voter eligible
only for the open item receives a token with
`eligible_item_ids=["item_a"]`. `POST /ballot/lookup` (unaffected by this
finding) already filtered `ballot_items` to the eligible set, but did **not**
filter the returned `candidates` list by item — so it still handed back the
restricted item's candidate id. That id, POSTed to `/ballot/vote`
(`cast_vote_with_token`) with the same token, was accepted and recorded: the
`eligible_positions` check is a no-op (`None`) for this election shape, and
nothing else checked the item restriction.

**Fix:** two changes, closing both the disclosure and the write:

1. `cast_vote_with_token` now also checks `voting_token.eligible_item_ids`
   for ballot-item elections: it recovers the matching ballot item from
   `candidate`'s effective position (the item's own `position` field, or its
   `id` when unset — the same derivation `submit_ballot_with_token` already
   uses) and rejects the vote if that item's id isn't in the token's
   snapshot.
2. `lookup_ballot_by_token` now also filters the `candidates` it returns to
   the positions of the (already `eligible_item_ids`-filtered) `ballot_items`
   it returns, so a restricted item's candidates are never disclosed to a
   token that can't vote for them in the first place.

Guarded by `TestSingleVoteTokenEnforcesItemEligibility` (3 cases: blocked,
allowed on the eligible item, unaffected when unrestricted) in
`test_election_codex_round2.py`, confirmed to fail pre-fix via `git stash`.

### ELEC-12 — LOW/MED — `SavedBallotTemplate` list/create still unbounded — 🚩 OPEN (re-verified, pass 3)

Unchanged from pass 1's write-up below: `list_saved_ballot_templates`
(`elections.py:387-400`) still returns `result.scalars().all()` with no
pagination, and `save_ballot_template` (`elections.py:403-452`) still
imposes no per-org creation cap. Re-read both handlers in full this pass —
line numbers and behavior identical to pass 1. Still flagged, not fixed, for
the same reason: both remedies (pagination envelope, a chosen numeric cap)
are product decisions, not mechanical fixes. Already mirrored in
`docs/KNOWN_LIMITATIONS.md` ("Elections — Saved Ballot Templates Have No
List Bound or Creation Cap", 2026-08-25) — confirmed that entry is still
accurate against current code.

**Round 1: 6 fixed (ELEC-13, ELEC-15, ELEC-17, ELEC-20, ELEC-21, plus the
doc correction folded into ELEC-14's write-up), 2 flagged (ELEC-14,
ELEC-16), plus ELEC-12 re-verified open.** The "0 fixes, 0 new findings"
conclusion this section originally recorded was wrong — not because the
diff-based scoping was wrong (it wasn't: the five core files really were
byte-identical to pass 2's landing commit), but because "unchanged since
pass 2" was taken to mean "still correct," and pass 2 itself had not caught
these six. A diff-based scope proves nothing changed; it does not prove
what didn't change was right.

Codex then reviewed the round-1 commit itself and posted 3 more findings —
2 P1s and a P2 — specifically on those fixes. Round 2 below.

### ELEC-22 — P1 — Round 1's item-eligibility allow-list dropped the legacy title fallback — ✅ FIXED

**What:** a ballot item persisted without its own `"position"` field (the
shape every item had before ballot items carried one) is matched to its
candidates by _title_, not id — a convention the voting UI
(`BallotVotingPage.tsx::getCandidatesForItem`) and
`ElectionService.check_voter_eligibility` (`election_service.py:999-1004`,
`item.get("position") == position or item.get("title") == position`)
already relied on before this review touched the file. Round 1's new
per-item eligibility checks (ELEC-21's `cast_vote_with_token` fix, and the
matching `lookup_ballot_by_token` filter) derived an item's "effective
position" as `item.get("position") or item.get("id")` — id, never title.
ELEC-20's `submit_ballot_with_token` fix inherited the same id-only
assumption for the plain-UUID `choice` branch (the `rankings`/
`candidate_ids` branches had already compared against that id-only value
since before this review, so this wasn't new there — but the round-1
`choice` fix newly applied it to a form that previously had no candidate
binding check at all).

**Where:** `elections.py:552-554` (`lookup_ballot_by_token`'s
`allowed_item_positions`), `election_service.py:7285-7295` pre-fix
numbering (`cast_vote_with_token`'s `matching_item` lookup), and the three
candidate-binding checks in `submit_ballot_with_token`
(`election_service.py:7743, 7766, 7860` pre-fix numbering).

**Failure scenario:** any existing candidate-selection ballot item created
before it carried an explicit `position` field, with its candidate(s)
stored under the item's title (the only shape possible before that field
existed, and still producible today — `create_candidate`'s position/
election.positions cross-check is skipped whenever the election has no
plain `positions` list, i.e. exactly the pure-ballot-item case). On deploy,
`/ballot/lookup` returns that item with zero candidates, and a submission
naming the candidate by its (retained, unchanged) id is rejected by all
three token routes — an existing, previously-working ballot renders empty
and becomes unsubmittable with no data changed on either side.

**Fix:** `ballot_item_candidate_positions(item)` (new module-level helper,
`election_service.py`) is the one place that decides which
`candidate.position` values belong to an item: the item's own `position`
when set, else its `title` _and_ `id` (mirroring the frontend's own
fallback). `lookup_ballot_by_token`, `cast_vote_with_token`'s item-matching,
and all three `submit_ballot_with_token` candidate-binding checks
(`choice`, `rankings`, `candidate_ids`) now call it instead of re-deriving
the set inline. The value newly stored on a vote (`Vote.position` for new
votes) is unchanged — this only widens what is _accepted_ as belonging to
an item, not what gets written going forward. `lookup_ballot_by_token` also
needed a second fix alongside this: naively applying the (now correct)
item-position set as a blanket filter over every returned candidate would
incorrectly strip out a _positional_ candidate (see ELEC-23) that isn't
tied to any item at all — the endpoint now only excludes a candidate that
belongs to a specific, _disallowed_ item, leaving a non-item candidate for
the `eligible_positions` filter below it to judge instead.

Guarded by `TestLegacyTitleKeyedCandidatePositions`
(`test_election_codex_round3.py`; unit test on the helper plus lookup/
cast-vote/submit-ballot integration cases), confirmed to fail pre-fix via
`git stash` (the helper doesn't exist pre-fix, so the whole module fails to
import).

### ELEC-23 — P1 — A positional candidate outside any ballot item bypassed eligibility entirely in a mixed election — ✅ FIXED

**What:** the election schema (`ElectionBase`) allows `positions` and
`ballot_items` to be configured on the same election with no
mutual-exclusion validator, and `create_nomination` will nominate a
candidate for any value in `election.positions` regardless of whether the
election also has ballot items. `send_ballot_emails`'s token-issuance logic
computed the `eligible_positions` snapshot only `if not election.ballot_items
and election.positions and election.position_eligibility` — so for _any_
election with ballot items, `eligible_positions` was unconditionally `None`
on every issued token, even when the election also had a `positions` list
with real `position_eligibility` rules. `cast_vote_with_token`'s per-item
check (ELEC-21) only ever fires when a candidate's position resolves to a
ballot item (`matching_item is not None`); when it doesn't — exactly the
case for a plain positional candidate — the block was skipped entirely.
With `eligible_positions` always `None` too, **no eligibility check of any
kind ran** for such a candidate: worse in kind than ELEC-21, which at least
had a check that was merely a no-op for the wrong reason, not a fallthrough
with nothing behind it.

**Where:** `election_service.py:6018-6029` pre-fix numbering
(`send_ballot_emails`'s `eligible_positions` snapshot, gated on
`not election.ballot_items`), and `election_service.py:7283-7295` pre-fix
numbering (`cast_vote_with_token`'s item check, silently skipped when
`matching_item is None`).

**Failure scenario:** an election configures one ballot item open to
everyone (`eligible_voter_types: ["all"]`) alongside a plain position
`"Secretary"` restricted to `["operational"]` via `position_eligibility`. An
administrative (non-operational) member is legitimately eligible for the
ballot item, so `send_ballot_emails` issues them a token —
pre-fix, that token always has `eligible_positions=None` because the
election has ballot items, regardless of the Secretary restriction.
`/ballot/lookup` for this token returns the Secretary candidate (positional
candidates were never filtered by the item-position logic, and the
`eligible_positions` filter is a no-op when `None`). Submitting that
candidate's id via `/ballot/vote` reaches `cast_vote_with_token`: the
`eligible_positions` check is skipped (`None`), and the item-eligibility
block's `matching_item` resolves to `None` (Secretary isn't a ballot item),
so its restriction is skipped too. The vote is recorded — an administrative
member votes for a restricted officer position with no check ever
executing.

**Fix:** two changes, addressing issuance and the check:

1. `send_ballot_emails` now computes `eligible_positions` whenever
   `election.positions and election.position_eligibility`, regardless of
   whether the election also has ballot items. The "skip this recipient
   entirely" branch for zero eligible positions is narrowed to
   `not eligible_positions and not eligible_items` — a mixed election must
   not stop sending a ballot to someone who _is_ eligible for an item just
   because they qualify for no plain position.
2. `cast_vote_with_token`'s eligibility logic is restructured so a
   candidate is judged by exactly one snapshot: if it resolves to a ballot
   item (via `ballot_item_candidate_positions`, ELEC-22), only
   `eligible_item_ids` governs it; otherwise (a genuinely positional
   candidate, or an election with no ballot items at all) only
   `eligible_positions` governs it. This also fixes a collateral bug the
   naive version of the issuance change alone would have introduced:
   `eligible_positions` is drawn only from `election.positions`, so
   applying it to an item-scoped candidate too (whose position is rarely a
   member of that list) would have wrongly rejected legitimate item votes
   in any mixed election. `lookup_ballot_by_token` got the equivalent
   restructuring (see ELEC-22's write-up) for the same reason.

An already-issued token from before this fix still carries
`eligible_positions=None` and remains in the fail-open state described
above — this cannot be fixed retroactively for a token already emailed —
which matches this module's existing documented posture for a `None`
snapshot ("legacy token or election without position rules — unrestricted,
time-bounded by token expiry"); tokens issued after this deploy are
correctly restricted.

Guarded by `TestMixedElectionPositionalCandidateFailsClosed`
(`test_election_codex_round3.py`; asserts the issuance snapshot via a real
`send_ballot_emails` call, that the ineligible positional vote is rejected,
and that the same token's eligible item vote still succeeds), confirmed to
fail pre-fix via `git stash`.

### ELEC-24 — P2 — Attestation and election deletion locked the batch/election pair in opposite orders — ✅ FIXED

**What:** ELEC-15's fix (round 1) added a `.with_for_update()` lock on the
`Election` row to `attest_manual_ballot_batch`, acquired _after_ the
existing batch lock — i.e. child-then-parent. Deleting an election
(`DELETE /{election_id}`) locks the `elections` row via the `DELETE`
statement itself, and MySQL's `ON DELETE CASCADE` on
`manual_ballot_batches.election_id` then locks each batch row as it cascades
— parent-then-child. A concurrent attest and delete on the same election can
each hold one row and block on the other (attest holds batch, waits on
election; delete holds election, waits on batch via the cascade) — a
classic InnoDB deadlock. Neither endpoint retries on a deadlock error, so
one of the two requests fails outright with a database error instead of a
clean "already deleted" / "still open" response.

**Where:** `election_service.py:3558-3591` pre-fix numbering
(`attest_manual_ballot_batch`: batch lock, then election lock).

**Fix:** the election lock is now acquired _before_ the batch lock in
`attest_manual_ballot_batch`, matching the parent-to-child order election
deletion already uses. Both locks are still acquired, and both are still
held before either status check runs, so ELEC-15's serialization property
(an attestation cannot observe a stale `OPEN` status past a concurrent
close) is unchanged — only the acquisition order moved. `close_election`
never locks the batch, so reordering carries no new deadlock risk on that
path.

Guarded by `TestAttestationLocksElection.test_election_locked_before_batch`
(new, `test_election_codex_round2.py`) plus an update to
`test_election_read_is_locking` in the same class (both now assert the
election query is `db.execute`'s _first_ call, not its second), confirmed
to fail pre-fix via `git stash`.

**Round 2: 3 fixed (ELEC-22, ELEC-23, ELEC-24).** All three were confirmed
real against current code before fixing — the same "verify, don't defer to
either party" standard round 1 applied to the initial 8 findings.

**Completion gate (pass 3, after both Codex rounds):**

| Check                                                                               | Result                                                                      |
| ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `flake8 app/ tests/ alembic/`                                                       | ✅ 0 violations                                                             |
| `black --check app/ tests/ alembic/`                                                | ✅ clean                                                                    |
| `isort --check-only app/ tests/ alembic/` (9.0.1, CI's pin)                         | ✅ clean                                                                    |
| `python3 scripts/validate_migrations.py --strict`                                   | ✅ 409 revisions, single head (`f7b3c8d2e569`) — no migration in this round |
| `pytest tests/ -q -k "election or ballot or vote or quorum"`                        | ✅ 472 passed, 1 skipped (pre-existing `py_vapid` optional dep), 0 failed   |
| `pytest tests/test_election_codex_round2.py tests/test_election_codex_round3.py -q` | ✅ 20 passed, 0 failed                                                      |
| `pytest tests/ -q` (full backend suite)                                             | ✅ 9792 passed, 21 skipped (pre-existing/environmental), 0 failed           |
| `tsc --noEmit` / `eslint .`                                                         | not run — no frontend file changed this round                               |

New guard tests: `tests/test_election_codex_round2.py` (2 new/updated tests
for ELEC-24's lock-order fix) and `tests/test_election_codex_round3.py`
(new file, 7 tests across ELEC-22 and ELEC-23). `tests/test_election_codex_fixes.py`'s
`TestTokenVoteNullPositionDedup._token()` stub was also given an explicit
`eligible_item_ids=None` default — ELEC-21's fix reads that attribute
unconditionally (as the real `VotingToken` model always has it), which a
stub predating the field did not.

---

## Pass 2 (2026-08-27)

**Scope correction (Codex review on PR #1948):** the first draft of this
section scoped its frontend check to `modules/elections/` and missed
`frontend/src/components/BallotBuilder.tsx` — a shared component, outside
that directory, that also changed since pass 1's merge and carried a real
defect (ELEC-19 below). The exact class of mistake feature 04 already
corrected: a component a feature touches is not guaranteed to live under
the feature's own module directory. Re-swept with `git diff --stat` against
`frontend/src/` broadly, not a directory glob, before writing "no findings"
again.

Scoped to the **full elections domain** since pass 1's merge commit
(`56b897ec`, PR #1810) — `endpoints/elections.py`, `election_service.py`,
`quorum_service.py`, `models/election.py`, `schemas/election.py`, every
frontend file under `frontend/src/` referencing election/ballot/quorum
concerns (not just `modules/elections/`), and every migration since,
checked by content (not just filename) for anything touching election
tables or eligibility logic. Four real changes since pass 1, all reviewed
in full — three carried real defects, caught by Codex across two review
rounds on this PR and independently verified against the actual code
before fixing, not taken on the bot's word:

- **`election_service.py` (+58/-25) — voter eligibility rewritten for the
  member-class/status split.** A same-day feature
  (`20260826_1400_f1a2b3c4d5e6_split_member_class_and_status.py`) replaced
  the fused `membership_type` column with independent `member_class`
  (operational/administrative/social) and `member_status`
  (prospective/probationary/regular/life/retired/honorary/junior) columns.
  `_user_has_role_type` — the function every ballot-eligibility and
  results-visibility check in the module calls — was rewritten to read the
  new columns, with a fallback to `split_membership_type()` for a
  pre-migration row. This is exactly the kind of change that could
  silently widen a restricted ballot's electorate, so it was read in full
  rather than skimmed:
  - Every legacy category (`operational`, `administrative`, `regular`,
    `life`, `probationary`) reproduces its pre-split meaning exactly —
    `operational` now requires `member_class == operational AND
member_status == regular`, matching the old `membership_type == "active"`
    check precisely, not just "any operational member" (which would have
    wrongly included probationary and retired members). `regular` and
    `life` are likewise class-**and**-status, not class-only.
  - `split_membership_type()`'s fallback deliberately returns `(None,
None)` for an org-configured custom tier (e.g. `"senior"`) rather than
    defaulting to a permissive value — confirmed by reading its docstring's
    own stated reasoning and cross-checked against the `_reconcile_membership`
    event listener (`models/user.py:542`, wired to both `before_insert` and
    `before_update`), which fills both columns on every ORM write, making
    the fallback a rare defense-in-depth path rather than the common case.
  - A new `"social"` category was added (`member_class == social`). Not
    dead code: `eligible_voter_types` (`schemas/election.py:86`) accepts
    any string with no fixed enum, falling back to a role-slug match, so
    an admin can set `"social"` today. Verified it satisfies only its own
    category, not `operational`/`administrative`/`regular` (no prior test
    covered this — added one).
  - The migration itself: guarded on `users` table existence (Pitfall
    #26), deliberately no `server_default` (would silently misclassify
    non-operational-regular rows on a raw-SQL insert — documented
    reasoning in the migration matches the fallback's), reversible with a
    documented, bounded information loss.
- **`election_service.py`, `notify_leadership_of_rollback` (~L4908) — an
  unrelated correctness fix in the same file.** Removed a
  `.join(User.roles)` that produced one row per position held, double-
  counting and double-emailing a leadership member who held two roles.
  Not a security issue (no access-control implication, an org-scoped
  notification path); confirmed no other instance of the same join pattern
  remains in the file (`get_package_recipients`'s sibling query was already
  correct).
- **`quorum_service.py` (+8) — `calculate_quorum` takes a
  `.with_for_update()` locking read on the `MeetingMinutes` row before
  computing `present_count` from its own `attendees` JSON column.** First
  draft called this Pitfall #27-compliant by construction (count read off
  the same locked row, no separate query to miss) — **wrong**, caught on
  Codex's first round. The lock is necessary but not sufficient on a
  session that already holds this row: `PATCH /minutes/{id}/quorum-config`
  (`set_meeting_quorum_config`) loads and commits the same
  `MeetingMinutes` instance, then calls `calculate_quorum` on the _same_
  session, before this method ever runs. With `expire_on_commit=False`
  (`core/database.py`) that instance stays in the session's identity map,
  and SQLAlchemy's default behavior on a re-`SELECT` for a row already in
  the identity map is to return the cached Python object **without**
  copying the new row's columns onto it — the lock is acquired at the SQL
  level, but `minutes.attendees` still reads the pre-lock value unless the
  query opts into `populate_existing`. This exact pattern (lock +
  `populate_existing`) was already established elsewhere in the codebase
  (`membership_pipeline_service.py`, `inventory_service.py`) for the
  identical reason — this file just hadn't caught up. Fixed by adding
  `.execution_options(populate_existing=True)`. Guarded by
  `test_minutes_fetch_repopulates_an_already_loaded_instance`
  (`test_quorum_service.py`), confirmed to fail pre-fix via `git stash`.
- **`frontend/src/modules/elections/routes.tsx` (+18/-14) —
  `requiredModule="elections"` added to all three election routes,
  mirroring a pre-existing backend `module_gate("elections", "Elections")`
  (`api/v1/api.py:206`, unchanged).** First draft called this "not a new
  access-control boundary" and stopped there — **incomplete**, caught on
  Codex's first round, and a real bug independent of this diff (the gate
  itself predates pass 1; this diff only made the frontend consistent with
  it). `module_gate` mounts `require_module` on the _whole_ `elections`
  router, including the explicitly public, token-authorized ballot routes
  (`POST /ballot/lookup`, `/ballot/vote`, `/ballot/vote/bulk`,
  `GET /{id}/verify-receipt`) — none of which declare a `current_user`
  dependency themselves. `require_module` resolves the caller's org via
  `get_optional_current_user`, which (correctly, for routes that read who
  is asking) raises rather than downgrading an invalid credential to
  anonymous. A voter clicking an emailed ballot link while their browser
  still carries an unrelated, expired/revoked `access_token` cookie from a
  since-ended main-app session therefore got a 401 before their ballot
  token was ever evaluated — the module gate, not the ballot logic,
  rejected them. Fixed by having `get_request_enabled_modules` call
  `get_optional_current_user` directly (not via `Depends`) and catch an
  invalid-credential `HTTPException`, treating it the same as no session
  at all for the _module flag_ specifically — an unusable session carries
  no more organization information than none. Does not weaken
  authentication anywhere else: an endpoint that declares its own
  `Depends(get_current_user)` still resolves and rejects independently.
  Guarded by
  `test_an_invalid_session_cookie_does_not_block_a_public_route_either`
  (`test_module_api_gating.py`), alongside the existing
  `test_a_request_with_no_session_is_not_turned_into_a_401` it mirrors.
- **`frontend/src/components/BallotBuilder.tsx` (+26/-9, outside
  `modules/elections/` — the file the first draft's scope missed) —
  ELEC-19, caught on Codex's second round.** Relabeled the
  `eligible_voter_types` picker for the member-class/status split, but got
  `operational` backwards: the new label read "Operational Members — any
  status, incl. probationary & life". `ElectionService._user_has_role_type`
  requires `member_class == operational AND member_status == regular` for
  the `operational` _category_ specifically (preserving its legacy
  `membership_type == "active"` meaning) — it does **not** include
  probationary, life, or retired members, even though those are all
  operational-class. An administrator relying on the new label would build
  a ballot believing probationary/life members were included when they
  were not — silent under-inclusion, not a privilege escalation, but a
  real defect in an election tool where turnout matters. The label (and
  the file's explanatory comment, which encoded the same wrong "class
  alone" mental model) corrected to state the narrower, accurate
  requirement.

**3 real findings, all fixed.** Plus one test gap closed (the new
`"social"` category had no coverage — added
`test_social_is_eligible_only_for_social_category` and
`test_administrative_is_eligible_for_administrative_category`).

**Completion gate (pass 2):** flake8/black/isort clean on `app/ tests/
alembic/`; `validate_migrations.py --strict` passed (383 revisions, single
head); scoped backend tests (`-k "elections or quorum or ballot or
module_gat"`) 269 passed, 1 skipped (pre-existing), 0 failed; full backend
suite 9069 passed, 22 skipped (pre-existing), 0 failed; `tsc --noEmit` 0
errors; `eslint src/components/BallotBuilder.tsx src/modules/elections/`
0 errors. Two of the three new guard tests confirmed to fail against the
pre-fix code via `git stash`; the module-gating fix changes _how_ the
dependency is resolved (a plain call instead of `Depends`), so its test
harness had to change with it and a clean stash-diff wasn't meaningful —
correctness there rests on tracing FastAPI's dependency-resolution order
directly, not a before/after run.

---

## Pass 1 (2026-08-25)

**Backend:** `api/v1/endpoints/elections.py` (3,809 L, 65 routes — 56
`require_permission`-gated, 5 authenticated-only self-scoped, 4 intentionally
public token routes), `services/election_service.py` (7,962 L),
`services/quorum_service.py` (139 L)
**Frontend:** `modules/elections`
**Migrations:** all 7 election tables are migration-created (not
`create_all`-only) — see Schema & migration notes.

---

## Scope

The most heavily audited module in the codebase before this iteration even
starts: module-audit iteration 5 (security-critical, 2026-07) plus a full
follow-up (R-1…R-13, R-D1…R-D5) and five app-review passes through
2026-08-21. Every prior finding across all of those is closed.

**The file sizes have nearly doubled since the module-audit's numbers were
written** — `elections.py` 2,721→3,809 L (46→65 routes), `election_service.py`
4,616→7,962 L — and that growth was never called out as a discrete finding in
any pass, so this iteration's primary job was figuring out what accounts for
it rather than re-deriving the (already extensively re-verified) prior
findings. Cross-checking the current route list against everything every
prior pass named (R-1…R-13's voter-overrides/proxy-authorizations/attendees/
manual-ballots/eligibility-roster, ELEC2-5/6's token-lock/schema work, R-D1…5's
token-hashing/receipt/ballot-lookup work) accounts for nearly all of the
growth — those features exist and are individually documented, the endpoint
_count_ at the top of `module-audit/elections.md` was simply never updated as
each was added (the same class of drift AUTH-01 found in the auth module's
route count). Corrected in `module-audit/elections.md`.

**One feature outside the module-audit/app-review/security-review doc set was
found:** `SavedBallotTemplate` (`models/election.py:32`, migration
`20260812_0001`, 2026-08-12) — organization-scoped, reusable ballot-item
snapshots. None of those three review series mentions it by name — but it is
not entirely unreviewed: `docs/KNOWN_LIMITATIONS.md` already carries a
2026-08-12 entry on it ("Saved Ballot Templates Accept Fields They Then
Discard"), evidently written at ship time rather than by a later audit pass.
That entry covers a schema-tolerance quirk (a stray key inside `ballot_items`
is silently dropped, while one at the template's own level correctly 422s);
this iteration's read confirms it is still accurate and did not re-derive
it. Read in full below for the angles that entry doesn't cover
(access control, tenant isolation, abuse resistance).

**Read in full:** the `SavedBallotTemplate` model, schema, and its three
endpoints (`GET/POST /templates/saved-ballots`, `DELETE
/templates/saved-ballots/{id}`). All 31 `select(Election)` call sites in
`election_service.py`, checked for organization scoping. `CHECKLIST.md`
dimension 7 (schema/migration integrity) against every election table.

**Re-verified by targeted check, not full re-read:** the pre-existing findings
(ELEC-1…9, R-1…13, R-D1…5, ELEC2-1…6) — each already has a re-verification
history across 5+ passes; this iteration spot-checked the mechanisms rather
than re-deriving them (see Verified good).

**Not re-read line-by-line:** the ~3,300 lines of `election_service.py` that
implement already-documented features (manual ballots, proxy voting, voter
overrides, PDF generation, package assembly) — each has its own
already-reviewed history and this pass found no signal (doc drift, a new
migration, a route-count change) suggesting undocumented change within them.

## Route inventory

**Corrected (Codex review, PR #1810):** the original pass of this section
said "61 carry `require_permission`... 4 are intentionally public," which
conflated _authenticated_ with _permission-gated_ for five self-scoped
voter-facing routes. The accurate split is 56 `require_permission`-gated + 5
authenticated-only (self-scoped) + 4 public = 65:

- **56 routes** carry `require_permission` (`elections.view` for reads,
  `elections.manage` for writes).
- **5 routes are authenticated-only** (`Depends(get_current_user)`, no
  permission string): `GET /{election_id}/eligibility` (`check_eligibility`),
  `POST /{election_id}/vote` (`cast_vote`), `POST /{election_id}/vote/bulk`
  (`cast_bulk_votes`), `GET /{election_id}/results` (`get_results`), and
  `POST /{election_id}/proxy-vote` (`cast_proxy_vote`). This is not a gap —
  it is the module's documented, audited design: these five do their own
  eligibility/self-scoping rather than a coarse permission string (any org
  member can attempt to vote; `check_voter_eligibility` inside the service
  decides whether that specific member, on that specific election, actually
  may — the ELEC-1 fix closed the one place this enforcement was missing).
  `module-audit/elections.md`'s own Notes section already states this; the
  route-inventory table just failed to reflect it accurately.
- **4 routes are intentionally public** (token is the credential, no
  `Depends` auth):

| Route                               | Compensating control                            |
| ----------------------------------- | ----------------------------------------------- |
| `POST /ballot/lookup`               | 512-bit token in body (never URL), rate-limited |
| `POST /ballot/vote`                 | same + row-locked (ELEC2-5)                     |
| `POST /ballot/vote/bulk`            | same + row-locked (ELEC2-5)                     |
| `GET /{election_id}/verify-receipt` | receipt hash is the credential, no PII returned |

(Module-audit's iteration-5 count of "5 public token endpoints" predates
R-D3's consolidation of two GET token-lookup routes into the single POST
`/ballot/lookup` — now 4, corrected above.)

## Verified good ✅ (re-confirmed this pass)

- **Tenant isolation holds on every `select(Election)` call.** All 31 sites in
  `election_service.py` checked: 28 filter `organization_id` directly; the
  remaining 3 are safe by construction — `process_election_lifecycle`'s
  per-election re-fetch (`:4104`) re-reads an id already drawn from an
  org-filtered query two lines earlier in the same function; the token path's
  election fetch (`:7019`) resolves through `voting_token.election_id`, where
  the token itself was already looked up by its own hash (the audited
  "token→tenant isolation is sound" mechanism); and the ELEC2-5 locking
  re-fetch (`:7071`) re-locks an election object already loaded and validated
  earlier in the same call. No unscoped scan of the FIN-9 shape exists here.
- **`SavedBallotTemplate` (new feature, reviewed for the first time) is
  access-control clean, but not abuse-resistance clean (see ELEC-12).**
  List/create/delete are all `elections.manage`-gated and org-scoped
  (`elections.py:397,421,467`); the create schema is `extra="forbid"` and
  accepts only name/description/ballot_items/voting_method/allow_write_ins —
  no election, voter, candidate, token, or result field, so a template cannot
  become a route for copying stateful or sensitive election data (the model's
  own docstring states this as an invariant, and the schema enforces it);
  per-org name uniqueness is a normalized hash (`name_key`) so an org can't be
  blocked by a case/whitespace variant; delete is 404-not-200 on a
  cross-org/missing id; both writes emit an audit event.
- **No SQL injection.** Zero `.like()`/`.ilike()` calls anywhere in the module
  (checked both files) — nothing for the LIKE-escaping class to apply to.
- **Schema & migration integrity clean.** All 7 election tables
  (`saved_ballot_templates`, `elections`, `candidates`, `voting_tokens`,
  `votes`, `manual_ballot_batches`, `manual_ballot_attestations`) are
  migration-created, not `create_all`-only — unlike the finance module
  reviewed last iteration, this is one of the codebase's foundational
  modules with full migration coverage. Every `ondelete="SET NULL"` FK in
  `models/election.py` (11 sites, all `created_by`/`recorded_by`/`checked_in_by`-
  style actor columns) pairs with `nullable=True`.
- **The headline security invariants (re-confirmed present, not re-derived):**
  512-bit tokens hashed at rest (ELEC-5), anonymous-ballot IP purge at close
  (ELEC-6), the eligibility gate on `cast_vote` (ELEC-1), org-scoped candidate
  update/delete (ELEC-2), method-aware vote-dedup hash (ELEC-3), rollback
  double-vote guard (ELEC-4), token-write row locking (ELEC2-5), and public
  schema `extra="forbid"` (ELEC2-6).

## Findings

One real gap (ELEC-12, flagged), one doc-accuracy correction (NIT, applied),
and one informational item.

### ELEC-12 — LOW/MED — `SavedBallotTemplate` list/create are unbounded — 🚩 FLAGGED

**What:** `list_saved_ballot_templates` runs an organization-scoped query and
returns `result.scalars().all()` with no pagination or limit
(`elections.py:395-400`), and `save_ballot_template` imposes no per-org cap
on how many templates can exist (`elections.py:408-452`). Caught by a Codex
review comment on the PR — the original pass of this section recorded the
endpoint as clean, which was correct on access control but wrong to call it
clean under checklist dimension 6 (abuse resistance).

**Where:** `backend/app/api/v1/endpoints/elections.py:395-400` (list),
`:408-452` (create).

**Failure scenario:** an `elections.manage` holder (a trusted role, not any
member) creates templates without limit; each may carry up to 250 ballot
items (`SavedBallotTemplateCreate.ballot_items`, `max_length=250`) with
2,000-character descriptions. Every load of the Ballot Builder's saved-templates
list materializes and serializes the organization's entire accumulated
collection in one response, with cost scaling per-org rather than being
capped.

**Impact:** LOW under the current threat model (gated to `elections.manage`,
not reachable by an ordinary member, and bounded per-item by the existing
schema limits) but MED in shape — it is the same "no `all()` over an org-wide
table" class flagged elsewhere in this rotation (e.g. FIN-7's unbounded
transaction export), and nothing currently stops it from growing unbounded
over the life of an organization.

**Fix:** not applied. Both remedies are behavior changes needing a product
decision rather than a mechanical fix: pagination on the list endpoint
changes the response envelope (this codebase's established pattern is
`PaginationParams` + slice, e.g. `finance.py`'s `list_member_dues`, but
adopting it here is a frontend-affecting contract change, not a drop-in);
a per-org creation cap needs an actual limit chosen by the org
(the same open-ended question FIN-7's export cap and CS-config's other
numeric limits were left to an owner decision). Flagged rather than guessed,
per this review's own standing rule against a wrong fix in a judgment call.
Mirrored into `KNOWN_LIMITATIONS.md`.

### ELEC-10 — NIT — Stale endpoint/line counts in `module-audit/elections.md` — ✅ FIXED

**What:** the module-audit header still read "2,721 L, 46 endpoints incl. 5
public token endpoints" / "4,616 L" — both roughly half the current size, and
never updated as R-1…R-13, R-D1…R-D5, and ELEC2-1…6 each landed real features.
**Where:** `docs/module-audit/elections.md:3-5`.
**Impact:** none directly, but an unmaintained size/count claim is exactly
what let this iteration's actual question — "is there unreviewed code here" —
go unasked for four app-review passes. **Fix:** corrected with both the
original and current numbers, and a pointer to this file for what the growth
accounts for.

### ELEC-11 — INFO — `SavedBallotTemplate` had no security-lens review until now

Not a defect — recorded so a future reader doesn't assume "most audited
module" implies "every table security-reviewed." The feature is two months
newer than the iteration-5 audit and was added without a corresponding entry
in the module-audit or app-review series (it does have a `KNOWN_LIMITATIONS.md`
entry from ship time, but that covers a schema-tolerance quirk, not access
control/tenant isolation/abuse resistance — the angle this review adds, and
where ELEC-12 was found). No action needed beyond this note.

## Schema & migration notes

All 7 election tables are migration-created (`saved_ballot_templates` via
`20260812_0001`; the original 6 via `20260118_0004` and `20260119_0006`/
`20260801_0007`) — none are `create_all`-only, unlike most of the modules
reviewed in this rotation so far. Every `SET NULL` FK is `nullable=True`
(verified line-by-line). No JSON-column shape concerns:
`SavedBallotTemplate.ballot_items` is written once per row at create time
(templates are immutable snapshots — there is no update endpoint), so
CLAUDE.md Pitfall #20's "one canonical shape, normalized on every write path"
concern about multiple writers disagreeing on shape doesn't apply — there is
exactly one writer.

## Guard tests added

None. No behavior changed this iteration — the fix is a documentation
correction, not code, so there is no class of regression for a test to guard
against.

## Completion gate

| Check                                                       | Result                                                      |
| ----------------------------------------------------------- | ----------------------------------------------------------- |
| `flake8 app/ tests/ alembic/`                               | ✅ 0 violations (no Python file changed)                    |
| `black --check app/ tests/ alembic/`                        | ✅ unchanged                                                |
| `isort --check-only app/ tests/ alembic/` (8.0.1, CI's pin) | ✅ clean                                                    |
| `validate_migrations.py --strict`                           | ✅ 356 revisions, single head                               |
| `pytest tests/ -k elections`                                | ✅ 94 passed, 1 skipped (unrelated `py_vapid` optional dep) |
| `tsc --noEmit`                                              | ✅ 0 errors (no frontend file changed)                      |
| `eslint .`                                                  | ✅ 0 errors/warnings (no frontend file changed)             |
