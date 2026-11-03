# Security Review 06 — Elections & Ballots

**Prefix:** `ELEC` · **Iteration:** 06 · **Reviewed:** 2026-08-25 (pass 1), 2026-08-27 (pass 2), 2026-09-02 (pass 3), 2026-09-08 (pass 4), 2026-09-14 (pass 5), 2026-09-15 (pass 6), 2026-10-05 (pass 7), 2026-10-12 (pass 8), 2026-10-14 (pass 9), 2026-10-18 (pass 10), 2026-10-22 (pass 11), 2026-10-25 (pass 12), 2026-10-28 (pass 13), 2026-11-01 (pass 14) · **PR:** [#1810](https://github.com/thegspiro/the-logbook/pull/1810) (pass 1), [#1948](https://github.com/thegspiro/the-logbook/pull/1948) (pass 2), [#2162](https://github.com/thegspiro/the-logbook/pull/2162) (pass 3, rounds 1-6, merged before round 7's fix was ready — see [#2173](https://github.com/thegspiro/the-logbook/pull/2173)), [#2173](https://github.com/thegspiro/the-logbook/pull/2173) (pass 3, round 7), [#2400](https://github.com/thegspiro/the-logbook/pull/2400) (pass 4), [#2546](https://github.com/thegspiro/the-logbook/pull/2546) (pass 5), [#2600](https://github.com/thegspiro/the-logbook/pull/2600) (pass 6 — corrected here from the "(this PR)" placeholder pass 6's own write-up left unresolved after merge), [#2947](https://github.com/thegspiro/the-logbook/pull/2947) (pass 7), [#3142](https://github.com/thegspiro/the-logbook/pull/3142) (pass 8), [#3248](https://github.com/thegspiro/the-logbook/pull/3248) (pass 9), pass 10 ([#3404](https://github.com/thegspiro/the-logbook/pull/3404)), pass 11 ([#3564](https://github.com/thegspiro/the-logbook/pull/3564)), pass 12 ([#3691](https://github.com/thegspiro/the-logbook/pull/3691)), pass 13 ([#3809](https://github.com/thegspiro/the-logbook/pull/3809)), pass 14 (this PR)

---

## Owner decisions applied (2026-10-05)

The owner decided the open ELEC and W50 items on 2026-10-05; each is applied
in its own commit on the `worktree-elections` branch and recorded here. A
finding below that says FLAGGED or OPEN is superseded by its line here.

- **ELEC-12** (`SavedBallotTemplate` list/create unbounded) — **fixed: a
  per-org creation cap of 200** (`MAX_SAVED_BALLOT_TEMPLATES_PER_ORG` in
  `elections.py`), enforced under a lock on the organization row with a
  locking count (pitfall #27); the 201st save is a 409. The list response is
  unchanged. Guard: `tests/test_saved_ballot_template_cap.py`.
- **ELEC-14** (receipt as a GET query parameter) — **fixed: `POST
/{election_id}/verify-receipt`** takes `{"receipt"}` in a body that forbids
  extra keys; the frontend uses it. The GET stays for external callers,
  marked `deprecated` in OpenAPI and answering `Deprecation: true` with a
  `Link` to the POST; both share `_verify_receipt` and the read rate limit.
  Guards: `TestReceiptVerificationRoutes` in
  `tests/test_w50_test_ballot_marking.py`, `electionService.test.ts`.
- **ELEC-40** (alias collision / pre-ELEC-34 legacy-hash gap) — **made
  unreachable for new ballots:** `_validate_ballot_item_identities`
  refuses an item whose title or position equals another item's id on
  create, update and saved template. Not taken: the `ballot_item_id` schema
  change and the re-hash migration. Residual (a ballot stored with a
  collision before the fix) stays in `docs/KNOWN_LIMITATIONS.md`. Guard:
  `tests/test_ballot_item_alias_collision.py`.
- **W50-22** (results gate needed the scheduled end even when CLOSED; also
  the first-drive W50-10) — **fixed:** `get_election_results` unlocks on
  CLOSED alone, or the pre-open live-tally flag. A closed election accepts
  no vote on any path, so its tally is final; a live tally stays refused.
  S10's permission shape (`elections.view`, 403 vs 404) is unchanged.
  Guard: `TestResultsVisibilityGate` in `tests/test_election_voting_flow.py`.
- **W50-13** (override on a restricted list shown as admitting a member
  the vote paths refused) — **fixed: an override extends the list.**
  `_restricted_voter_ids` (the list plus override holders) is the one
  definition read by `check_voter_eligibility`, the ballot mailer, the
  non-voter list and the unfrozen denominator; the frozen-roll denominator
  already added overrides. Guard: `tests/test_w50_override_extends_list.py`.
- **W50-19** (a draft's test ballot link answered "Election is draft") —
  **fixed: a test token is admitted on a DRAFT.** `_token_window_error`
  is the one window rule for lookup and the locked submission: a live
  token still needs an OPEN election inside its window; a test token may
  also use a draft, whose future start is not enforced (its end is). Its
  votes stay `is_test`, test-namespaced in the dedup hash and excluded from
  every tally and from the candidate-edit guard. Guard:
  `tests/test_w50_test_token_draft.py`.
- **W50-23** (proxy holder Cc'd a ballot saying the link is the voter's
  alone) — **fixed, Cc kept:** the ballot email's link card is a variable
  the sender fills, naming the holder and whose ballot it is on a proxied
  send; names are HTML-escaped. Migration `24f56e4fc320` carries untouched
  stored bodies (guarded on the table, idempotent, real downgrade); an
  edited template gets the notice at the head of the message. The Cc itself
  is unchanged. Guard: `tests/test_w50_proxy_ballot_mail.py`.
- **W50-8** (paper ballots could not record a motion) — **fixed:**
  `open_election` creates each approval item's Approve/Deny rows under the
  item's canonical key (`approval_option_position`, the key the token route
  already stores votes under), reusing a row a vote materialised; a rollback
  to draft drops only rows no vote references. Paper votes on them are
  ordinary signed, chained manual votes. The printable ballot also carries a
  candidate-selection item outside `election.positions`. Guard:
  `tests/test_w50_paper_motion_options.py`.
- **W50-9** (certified results silently revised by merge/void after
  close) — **fixed, corrections kept and marked:** `soft_delete_vote`,
  `void_manual_ballot_batch` and `merge_write_in_candidates` call
  `_record_results_revision` on a CLOSED election, appending
  `{at, by, by_name, action, detail}` to the new `elections.results_revisions`
  (migration `5b1e7d3c9a42`, guarded, real downgrade); the certified PDF and
  the Results tab print each as "Revised <when> by <who>". Votes are never
  re-pointed or re-signed, so integrity verification is untouched; a
  rollback to open clears the marks. Guard: `tests/test_w50_results_revised.py`.
- **ELEC-28 / W50-10** (in-app ballot showed positions only; the emailed
  ballot could not carry a plain position) — **fixed: one ballot model.**
  `position_ballot_items` serves each plain position no item claims as a
  ballot item (id `position-<sha256 prefix>`, explicit `position`), so its
  votes are stored, deduplicated and tallied under the position name exactly
  as before. The token lookup adds the ones in the token's
  `eligible_positions`; `submit_ballot_with_token` accepts them and checks
  them against the positions snapshot (never `eligible_item_ids`), refusing
  Approve/Deny on them. The in-app ballot (`GET/POST /{id}/ballot`) takes
  the emailed shape and records each selection through `cast_vote(commit=
False)` in one transaction, so eligibility, limits, the dedup hash, the
  signature, the chain and the anonymous audit row are those of every in-app
  vote; one refusal rolls back the ballot. `_validate_vote_limits` and the
  in-app/proxy dedup discriminator now honour an item's method override, as
  the token route and the tally already did (ELEC-37). `check_voter_
eligibility`'s "already voted in this election" applies only to a ballot
  with no items. Guard: `tests/test_ballot_convergence.py`.
- **Proxy ballot mode** (configured proxies could not vote) — **finished
  for named elections:** the Cast Vote tab's "Voting for" choice loads the
  delegating member's ballot and submits through `cast_proxy_vote`
  (`commit=False`). On an anonymous election it needs the delegating
  member's acknowledgement (ELEC-43, decided 2026-10-08). Guard:
  `TestProxyBallot` in `tests/test_ballot_convergence.py`.
- **W50-11** (a "(2 seats)" race declared one winner) — **fixed:
  `elections.seats_per_position`** (migration `8c4f2a6e1d93`, guarded,
  real downgrade; default 1, so every stored election tallies as before).
  `_declare_seat_winners` marks up to that many qualifiers; a multi-seat
  race's percentages are of ballots cast (`_count_ballots_cast`, already
  conservative for paper) rather than of vote rows. `seat_rule_error`
  refuses ranked choice and a per-race cap below the seats on create and
  on update against the stored half. Votes, signatures and the chain are
  untouched — this is tally-only. Guard: `tests/test_w50_seats_per_position.py`.
- **ELEC-16** (`list_manual_ballot_batches` unbounded) — **accepted as is.**
  Paper-tally sessions per election are naturally few; no cap and no
  pagination. Revisit if an election ever carries more than a few dozen
  batches. Recorded in `docs/KNOWN_LIMITATIONS.md`.

## Pass 14 (2026-11-01) — watchdog pickup, real delta: election-wide voter eligibility rules, per-member voting-wait override, wired election defaults

**Scoping.** Step 0 (via GitHub, not the tracker): `list_pull_requests`
(`state=open`) returned 15 open PRs, none with a head branch starting
`claude/security-review-`; the open PR noted in `PROGRESS.md`'s "Open PR" row
(#3890, Feature 05, pass 14) had already merged (`43a63764`, confirmed by
`git log -1 origin/main`). Row 06 (Elections & ballots) is the next `⬜` row,
matching that PR's own "next feature" note. Watchdog pickup — the dedicated
`/loop 30m /security-review` session was reported unreachable by the watchdog
that handed off this task.

**Baseline and delta.** Baseline is pass 13's merge (`3f1d5b940`, PR #3809,
2026-10-28). Unlike pass 13's small three-item delta, `git diff --stat
3f1d5b940..origin/main` across this feature's established scope shows a real
feature delta: 174 non-merge commits landed on `main` in the window, 8 of
which touch this feature's scope (`elections.py`, `election_service.py`,
`schemas/election.py`, `models/election.py`, and the frontend
`modules/elections`/`pages/Elections*` tree) — 2,367 insertions, 152
deletions across 10 files. Three new, nullable/defaulted, `create_all`-guarded
migrations (`e1a7c4b2d9f3`, `b3d58e0c71a4`, `c7e2a91f4d36`), none altering an
existing election's or member's live eligibility on upgrade (verified by
reading each migration's upgrade() against Pitfall #35 — see **Schema &
migration notes**).

**The eight commits, each read in full:**

1. **`83cf79802` — ELEC2-9 resolved: election defaults now have a reader.**
   The seven `default_*` fields `PATCH /elections/settings` already stored
   (flagged inert by app-review's ELEC2-9 and `KNOWN_LIMITATIONS.md`) now seed
   the Create Election form; `_election_defaults_view` degrades a value
   stored before the new choice-validator existed, or an explicit null, to
   the form's own built-in rather than handing the form a value it would
   submit and have refused. `KNOWN_LIMITATIONS.md`'s ELEC2-9 entry is already
   marked resolved by this commit itself — nothing further needed here.
2. **`5ec1897d4` — members feature's class/status split; this feature's only
   touch is 41/23 lines in `election_service.py`** adapting
   `_user_has_role_type`'s type resolution to the new two-column membership
   model and a department's own tier `ranks_as` a built-in status. The
   `Organization` lookup inside the new `_ranks_as_for_org` cache helper is
   keyed on the caller's own `organization_id` (no client-supplied id), so no
   new XC-1/XC-3 surface. Primarily a Members-feature (07/08) change; verified
   here only for its in-scope touch.
3. **`cfca77c03` — new column `elections.eligibility_rules` + the
   `_universal_gate` shared helper (ELEC-06's real security surface this
   pass).** A department's attendance/tenure voter-eligibility rules, set on
   `PATCH /elections/settings` and copied onto each election at create. See
   **Findings** for the one defect found (ELEC-51, fixed) and the verified
   invariants.
4. **`d461284f5` — a second, optional default set for elections held at the
   annual meeting** (`elections.meeting_kind`). `_meeting_kind_of_link`
   resolves a client-supplied `meeting_id` through an org-scoped `Meeting`
   query (XC-1-compliant — a cross-org id simply falls back to `"regular"`,
   never adopts another org's meeting record).
5. **`91ffab5e0` — cosmetic:** a validator's refusal message rebuilt with
   `list_within_detail_limit` to satisfy `test_refusal_detail_sweep`; same
   text, no behavior change. Re-ran the sweep clean (24 passed).
6. **`9894e57ba` — frontend-only** layout fix (phone-width eligibility rows);
   no backend touch.
7. **`86df394c3` — per-member-type voting waiting periods + a per-member
   secretary override** (`GET`/`PUT /elections/members/{user_id}/voting-
eligibility`, new `users` columns via `c7e2a91f4d36`). See **Route
   inventory** and **Findings**.
8. **`e790169ef` — mypy-ratchet fix only,** no behavior change.
9. **`0d1f0298a` — a W50 browser re-drive's own fix, already shipped before
   this pass started:** the voting-wait override now refuses a `voting_wait_
from` after the department's today (guarded by `test_a_date_after_the_
departments_today_is_refused`, already present and passing). Re-verified by
   direct read, not re-implemented.

**Re-enumeration (AST, not inherited from pass 13's count).** `elections.py`:
**75 routes**, up from 73. Every route still carries a `Depends(...)` in its
signature — **0 routes with no auth dependency.** Classification: 5
public/token-scoped (`lookup_ballot_by_token`, `cast_vote_with_token`,
`submit_ballot_with_token`, `verify_vote_receipt_post`,
`verify_vote_receipt` — unchanged from pass 13), 7 self-service/sign-in-only
(matching `tests/permissionless_route_baseline.txt`'s 7 `elections.py`
entries, unchanged), 1 OR-gated (`list_candidates`:
`require_permission("elections.view", "elections.manage")` — both
election-specific, no broad/wildcard grant, not a Pitfall #23 case), and 62
single-permission `require_permission`-gated — **63 total carrying
`require_permission`, including the 2 new routes.** The two new routes
(`get_member_voting_eligibility`, `update_member_voting_eligibility`) are
both gated `elections.manage` — the write is a sensitive per-member override
of who may vote, so `.manage` (not `.view`) is the right sensitivity, closing
off an XC-2 concern before it existed.

## Verified good ✅ (pass 14)

- **The new voting-eligibility routes resolve their target member through
  `_org_member`** (`elections.py:1519`), which filters
  `User.id == user_id, User.organization_id == organization_id,
User.deleted_at.is_(None)` — XC-3-compliant; a cross-org `user_id` 404s
  rather than ever reaching `apply_updates`.
- **The override payload cannot write an arbitrary `User` column.**
  `MemberVotingEligibilityUpdate` (`schemas/election.py:2121`) is
  `extra="forbid"` with exactly three fields (`voting_wait_from`,
  `voting_wait_waived`, `reason`); after `reason` is popped, `apply_updates`
  (Pitfall #1) only ever sees the two columns the feature intends, with no
  `skip=` needed because the schema itself is the allowlist. Checked by
  reading `apply_updates`'s call site directly, not inferred.
- **A future `voting_wait_from` is refused** (`elections.py:1598-1604`,
  shipped by `0d1f0298a` before this pass): re-ran
  `test_a_date_after_the_departments_today_is_refused` — passes.
- **A reason is required to set an override, cleared with the last of them,
  and the before/after is audit-logged** with the log message built from a
  single `logger.info("... | member={} by={}", member.id, current_user.id)`
  call (Pitfall #33-compliant — no f-string combined with positional args).
- **`ElectionEligibilityRules`/`AttendanceRule`/`WaitingPeriod` are all
  `extra="forbid"` with `Field(ge=..., le=...)` bounds on every numeric input**
  (`schemas/election.py:350-480`) — no unbounded attendance look-back or
  waiting-period length reaches storage.
- **`update_election`'s OPEN/CLOSED branches refuse `eligibility_rules` and
  `meeting_kind`** (`elections.py:1714-1761`, pre-existing, re-verified): an
  open election's allowlist is `{"end_date"}` alone, closed is
  `{"results_visible_immediately"}` alone — neither new field is in either
  set, so a running election's electorate cannot be redrawn after ballots
  are out, matching the commit message's own claim.
- **`evaluate_wait` fails to "no rule" (eligible), never to "ineligible", on
  malformed stored data** (`membership_tier_service.py:293-330`) — a
  deliberate, documented choice so a corrupt JSON rule cannot silently
  disenfranchise a member; re-derived from the source, not taken on the
  commit message's word.
- **`_universal_gate` is the one definition of override → tier → election-
  rules, and three of its four call sites already used it** before this pass
  (`_member_voting_gates`, `annotate_ballot_items_for_user`, the positional
  branch at `election_service.py:12021`) — the fourth did not; see ELEC-51.
- **Migrations `e1a7c4b2d9f3`/`b3d58e0c71a4`/`c7e2a91f4d36` all guard against
  `create_all` (Pitfall #26), are nullable or server-defaulted (Pitfall #2 n/a
  — no `SET NULL` FK here), and state their backfill's irreversibility in the
  docstring** (Pitfall #35) — read directly, not inherited.
- **Standing findings re-confirmed unchanged by direct re-read:** ELEC-12
  (fixed, cap unchanged), ELEC-14 (fixed), ELEC-16 (accepted as is, still no
  pagination), ELEC-28 (resolved, per pass 13's correction — unchanged),
  ELEC-40 (flagged, `_validate_ballot_item_identities` still present at
  `schemas/election.py:88`), ELEC-48 (flagged, both synchronous send
  endpoints — `send_ballot_emails:3568`, `send_pre_meeting_package:3889` —
  still present, no row lock added), ELEC-50 (fixed, guard test unchanged).
  ELEC-49 is unchanged because the file it concerns,
  `minutes_election_filing.py`, has a byte-identical, empty diff since pass
  13's baseline (`git diff --stat 3f1d5b940..origin/main` on that path
  returns nothing).

## Findings (pass 14)

### ELEC-51 — LOW — `_get_ineligibility_reason_for_user` duplicated the override/tier gate instead of calling `_universal_gate`, and crashed on a malformed stored tier value — ✅ FIXED

**What:** `_get_ineligibility_reason_for_user` (pre-existing, from PR #3724,
unrelated to this pass's own commits) builds the admin-facing "why was this
member skipped" message for the ballot-send skip list
(`election_service.py:9088`) and the eligibility roster
(`election_service.py:12034`). It re-implemented the secretary-override and
membership-tier check inline instead of calling the new `_universal_gate`
that `annotate_ballot_items_for_user` and `_member_voting_gates` already use
— the one shared definition CLAUDE.md Pitfall #29 asks for. The inline
version also read `org.settings["membership_tiers"]` with a bare
`.get("tiers", [])`, with no `isinstance(tier_config, dict)` guard the
sibling helpers (`_tier_benefits`, `_tier_name`) already carry.

**Where:** `backend/app/services/election_service.py:1357-1373` (before fix).

**Failure scenario:** if an organization's stored `org.settings
["membership_tiers"]` is ever a non-dict value (a string, a list — reachable
from any code path that writes `org.settings` without validating that key's
shape), the next admin click of "Send ballot emails" or "Eligibility roster"
for that org raises an unhandled `AttributeError` inside the request, 500ing
the whole send/roster call for every recipient, not just the one with the
bad-shaped setting. Reproduced directly: a `Mock` organization with
`settings={"membership_tiers": "not-a-dict"}` passed to
`_get_ineligibility_reason_for_user` raised `AttributeError: 'str' object
has no attribute 'get'` before the fix (see guard test below, run against
the pre-fix code and seen to fail per Pitfall #37).

**Impact:** availability only (an admin-facing 500, not an access-control
bypass — the function's return value is display text, never consulted by
`_get_eligible_ballot_items_for_user`'s real gating decision or by
`will_receive_ballot` in the roster). LOW rather than MED/HIGH because
nothing votes, sees, or is granted access to anything on account of this
function's output.

**Fix:** replaced the inline override + tier-config read with a call to
`self._universal_gate(user, election, organization_id, org)`, matching the
message format exactly (`f"Membership tier '{tier_name}' is not eligible to
vote"` is unchanged) while gaining `_tier_benefits`'s defensive `isinstance`
check for free. Guard: three new tests in
`tests/test_election_eligibility_rules.py`
(`TestIneligibilityReasonUsesTheSharedGate`) — a non-dict `membership_tiers`
no longer crashes, a voting-ineligible tier still reports through the shared
gate with the same wording, and a voter override still short-circuits to
`None`. The crash test was run against the pre-fix code and failed there
(`AttributeError`), then re-run against the fix and passed, per Pitfall #37.

## Schema & migration notes (pass 14)

Three new migrations, all additive, all `create_all`-guarded (Pitfall #26),
none backfilling a value that changes who may vote in an existing election:

- **`e1a7c4b2d9f3`** — `elections.eligibility_rules` (JSON, nullable, no
  default). Existing rows read NULL → "no election-wide rules", exactly what
  every election enforced before the column existed.
- **`b3d58e0c71a4`** — `elections.meeting_kind` (`VARCHAR(20)`, **NOT NULL**,
  `server_default='regular'`). Every existing row reads as a regular-meeting
  election the moment the column exists, no separate backfill (Pitfall #35
  compliant — the tightened-without-settling-existing-rows failure mode this
  pitfall warns about does not apply here because the server default fills
  every row at `ALTER TABLE` time, not at a later UPDATE).
- **`c7e2a91f4d36`** — five `users` columns. `voting_wait_waived` is **NOT
  NULL** with `server_default=false` (Pitfall #2 n/a — no `ondelete`
  involved, but the same "existing rows must resolve" principle is honored
  the same way). The three date/reason columns are nullable. The one
  best-guess backfill (`member_status_since`/`member_class_since` from
  `membership_type_changed_at`/`hire_date`) is explicitly stated as
  irreversible in the docstring (Pitfall #35) and guarded to run only when
  the `_since` columns were just created (`WHERE member_status_since IS NULL
AND member_class_since IS NULL`), so a re-run cannot clobber a date the
  application has since stamped.

`validate_migrations.py --strict` re-run: single head, no fork (see
**Completion gate**).

## Guard tests added (pass 14)

- `tests/test_election_eligibility_rules.py::TestIneligibilityReasonUsesTheSharedGate`
  (3 tests) — ELEC-51: a malformed stored tier value does not crash the
  skip-reason builder, a voting-ineligible tier still reports through the
  shared gate, and a voter override still short-circuits. The crash test was
  confirmed to fail against the pre-fix code (Pitfall #37).

No other fix was made this pass — the three fixes in prior pass sections stay
attributed to their own passes.

## Completion gate (pass 14)

| Check                                                        | Result                                                              |
| ------------------------------------------------------------ | ------------------------------------------------------------------- |
| `flake8 app/ tests/ alembic/`                                | ✅ 0 violations                                                     |
| `black --check app/ tests/ alembic/`                         | ✅ clean (1 file reformatted before commit: the new test additions) |
| `isort --check-only app/ tests/ alembic/`                    | ✅ clean (isort 9.0.2, already installed)                           |
| `validate_migrations.py --strict`                            | ✅ 682 revisions, single head `db30a34afa5b`                        |
| `check_route_permissions.py --strict` (repo root)            | ✅ 281 routes, 0 errors, 0 warnings                                 |
| `pytest tests/ -k "election or ballot or vote or candidate"` | ✅ 1305 passed, 1 skipped (env-only `py_vapid`)                     |
| `pytest tests/test_refusal_detail_sweep.py`                  | ✅ 24 passed (re-run after the `list_within_detail_limit` commit)   |
| `cd frontend && npm run typecheck`                           | ✅ 0 errors                                                         |
| `cd frontend && npm run lint`                                | ✅ 0 errors, 0 warnings                                             |

**1 fixed (ELEC-51, LOW), 0 new OPEN/FLAGGED findings** (ELEC-16, ELEC-40,
ELEC-48, ELEC-49 re-confirmed unchanged from pass 13, all already mirrored in
`docs/KNOWN_LIMITATIONS.md`). ELEC2-9, previously flagged by the app-review
rotation, was resolved by this window's own `83cf79802` (not by this
security-review pass) and is re-verified correct here; `KNOWN_LIMITATIONS.md`
already reflects it as resolved.

## Pass 13 (2026-10-28)

**Scoping.** Step 0 (via GitHub, not the tracker): `search_pull_requests`
(`is:pr is:open head:claude/security-review-`) returned 0 matches immediately
after PR #3807 (Feature 05, Finance & approvals, pass 13) merged — confirmed
via `pull_request_read` (`merged: true`, `2026-10-28T12:21:33Z`). Row 05 is
`✅`; row 06 (Elections & ballots) is the next `⬜` row, matching PR #3807's own
"Next" note. **Watchdog pickup:** the dedicated `/loop 30m /security-review`
session (`session_011T1ZyyLrD5HagusgK9uDw2`) remains unreachable (`ListAgents`
returned no reachable peer on this machine) — PR #3807's own write-up recorded
the same condition a few hours earlier, and every pass back through pass 10
has recorded it too.

**Baseline and delta.** Baseline is pass 12's merge (`e660a9c3`, PR #3691,
2026-10-25). Unlike pass 12's true-zero delta, `git diff --stat
e660a9c3..origin/main` across the feature's established scope
(`api/v1/endpoints/elections.py`, `services/election_service.py`,
`services/minutes_election_filing.py`, `schemas/election.py`,
`models/election.py`, `utils/election_ballot_pdf.py`,
`utils/election_pdf_style.py`, `mcp/tools/elections.py`, and the frontend
`modules/elections` tree) shows a real but small change: 56 insertions, 7
deletions across `elections.py`, `election_service.py` and `schemas/
election.py` only. None of the 37 migrations merged in this window (contact
and email encryption, passkeys, sensitive form fields, event guest check-in,
leave/waiver encryption, several head merges) touch any of the 7 election
tables — confirmed by grepping every new migration's `op.*` calls for
`elections|candidates|votes|voting_tokens|manual_ballot|saved_ballot`: no
hits.

**The diff itself, reviewed line by line, is three already-shipped fixes**
(not part of this rotation — landed on `main` by other work between passes),
verified correct rather than re-implemented:

1. **Dangling write-in merges, closed.** Deleting the target of a write-in
   merge used to leave the merged variant's `merged_into_candidate_id`
   pointing at a row that no longer existed — the column carries no foreign
   key — so the variant's votes were silently credited to a missing
   candidate and vanished from the tally. `ElectionService
.release_merged_write_ins()` (`election_service.py:5844`) now clears the
   merge before every candidate-deletion path: the `DELETE
/{election_id}/candidates/{candidate_id}` endpoint
   (`elections.py:2712`, its audit event now records
   `write_in_merges_released`), a declined nomination
   (`election_service.py:4976`), and `_drop_unused_approval_option_rows`'s
   bulk cleanup on rollback-to-draft (`election_service.py:7306`). All three
   call sites resolve the election through an org-scoped fetch before
   touching any candidate row (14b), and `release_merged_write_ins` itself
   additionally scopes its `UPDATE` by `election_id`, so it cannot reach a
   candidate outside the election already proven to belong to the caller's
   org. `get_election_results`'s merge-map construction
   (`election_service.py:3300-3306`) was separately hardened to ignore a
   merge whose target is not among the election's own candidates — handling
   any row left dangling by a delete that happened before this fix shipped,
   without needing a backfill migration. Guard:
   `tests/test_election_merged_candidate_delete.py` (three tests: the
   target survives with its votes after delete, a pre-existing dangling
   merge is ignored, and declining a nomination releases the merge too).
2. **Quorum-percentage validation reaches the org-defaults endpoint.**
   `PATCH /elections/settings` (`ElectionSettingsUpdate`, `elections.py:936`)
   writes `default_quorum_value`/`default_victory_percentage` into the
   organization's election defaults, and until now was the one write path
   with no bound: a value above 100 for a `percentage` quorum, or a
   negative/absurd value for either field, stored cleanly and only broke
   later when an election was created from the defaults. The two fields now
   carry `Field(ge=1, le=INT32_MAX)` / `Field(ge=1, le=100)`
   (`elections.py:938-943`, the same `INT32_MAX` column-bounds constant used
   elsewhere in this schema), and the endpoint now re-checks the _merged_
   result after an update (`elections.py:1100-1106`) — necessary because an
   update can set only the type or only the value in one call, so neither
   field alone says whether the resulting pair is valid. This brings the
   defaults endpoint in line with the per-election create/update path
   (`schemas/election.py:512-517`, `elections.py:1398-1409`), which already
   had the same check. `schemas/election.py`'s `BallotItem
.required_for_approval` and `PositionEligibility.min_votes_required`
   gained matching upper bounds. No endpoint lost a previously-accepted
   value: every bound is wide enough to admit any real election's numbers,
   and the only rejected inputs (quorum > 100%, negative counts) were never
   valid. Guard: `tests/test_election_feature_settings.py`.
3. **A leadership-notification email now checks the template's own
   switched-off flag.** `election_service.py:7688-7695` reads
   `EmailTemplateService.is_switched_off()` before sending (via
   `_notify_election_leadership`'s shared send path) and skips with a logged
   notice rather than sending unconditionally. This closes the same class of
   gap Pitfall #19 describes — a config switch with no reader — for this one
   send path; the log call passes `template_type.value` and
   `organization_id` as arguments rather than splicing them into the message
   (Pitfall #33-compliant).

No source file in this feature's scope needed a touch from this review itself
— the three items above were already fixed on `main` by the time this pass
started; this pass's job was to verify each against the seven checklist
dimensions (authorization/tenant isolation for the deletion paths; input
validation/abuse resistance for the bounds; data exposure/injection — neither
applicable, no new query shape) and confirm none introduced a regression.

**Re-enumeration.** `elections.py` re-walked by AST: **73 routes**, unchanged
from pass 12, every one still carrying a `Depends(...)` in its signature. The
5 intentionally-public, token-scoped routes are unchanged in behavior (lines
shifted by the diff above, not their logic): `POST /ballot/lookup`
(`lookup_ballot_by_token`, `:668`), `POST /ballot/vote`
(`cast_vote_with_token`, `:826`), `POST /ballot/vote/bulk`
(`submit_ballot_with_token`, `:885` — **correction:** the route at this path
is `submit_ballot_with_token`; `cast_bulk_votes` is a different, self-service
route at `POST /{election_id}/vote/bulk`, `:2934`, already correctly listed
in `permissionless_route_baseline.txt`), `POST /{election_id}/verify-receipt`
(`verify_vote_receipt_post`, `:4802`), and `GET /{election_id}/verify-receipt`
(`verify_vote_receipt`, `:4825`). The diff's three hunks sit entirely outside
these five routes. Confirmed against the 5+7+1+60 = 73 classification: 5
public/token-scoped, 7 self-service gated by sign-in alone (listed in
`permissionless_route_baseline.txt`), 1 OR-gated (`list_candidates`:
`elections.view` or `elections.manage`), and 60 `require_permission`-gated.

**App-review cross-check (Step 2).** ELEC2-8 (`has_user_voted` has no
production caller) re-verified unchanged by a repo-wide grep excluding its own
definition and a docstring reference: still called only from
`tests/test_election_voting_flow.py`. Dead code, not a security defect;
unchanged disposition, left to the app-review rotation.

**Verified good (re-confirmed, not re-derived):** the five headline
mechanisms restated across passes 11-12 — 512-bit tokens hashed at rest
(ELEC-5), anonymous-ballot IP purge at close (ELEC-6), the eligibility gate on
`cast_vote` (ELEC-1), method-aware vote-dedup hash (ELEC-3), and token-write
row locking (ELEC2-5) — are unchanged; none of their implementing lines
appear in this pass's diff.

**Standing findings re-confirmed unchanged:**

- **ELEC-12** — fixed (`MAX_SAVED_BALLOT_TEMPLATES_PER_ORG = 200`,
  `elections.py:159`). Unchanged.
- **ELEC-14** — fixed (`POST /{election_id}/verify-receipt`); deprecated
  `GET` variant kept for external callers. Unchanged.
- **ELEC-16** — accepted as is (owner decision); `list_manual_ballot_batches`
  still has no cap or pagination.
- **ELEC-28** — **RESOLVED — correcting this pass's own first draft, and
  passes 11/12.** Pass 9 (2026-10-14) read `ElectionBallot.tsx` and
  `BallotItemCard.tsx` directly and found ELEC-28/W50-10/W50-11 already
  fixed by the owner's 2026-10-05 decisions: the in-app ballot renders every
  ballot item (not positions alone) through the same `BallotItemCard` the
  emailed ballot uses, caps a multi-select at `max_votes_per_position`, and
  names the seat count when `seats_per_position > 1`. Pass 10 re-confirmed
  this. **Passes 11 and 12, and this pass's own first draft, then each
  re-listed it as OPEN/unchanged without re-reading those two frontend
  files** — the files are outside every one of those passes' own diffs
  (including this one's), which is exactly how a stale copy-paste survives
  undetected across three passes. Re-read fresh, directly, before this
  commit: `ElectionBallot.tsx`'s docstring states the fix in the past tense
  ("It used to be built from `election.positions` alone... (W50-10,
  ELEC-28)"), its body reads `data.election.ballot_items` and renders
  through `<BallotItemCard>` (`ElectionBallot.tsx:7-14,63,95,269`), and
  `BallotItemCard.tsx:129` names the seat count for
  `seats_per_position > 1`. Neither file has changed since pass 9 found
  this. Corrected here rather than rewriting history, per this file's own
  precedent (see pass 9's correction of pass 7/8, above) — the inline notes
  on passes 11 and 12's own entries are corrected in the same commit.
- **ELEC-40** — FLAGGED. New-ballot collision still made unreachable by
  `_validate_ballot_item_identities`; the pre-existing-ballot residual is
  unchanged and still mirrored in `KNOWN_LIMITATIONS.md`.
- **ELEC-48** — LOW, FLAGGED. The synchronous send endpoints still race each
  other with no job-row lock for either side; this pass's diff did not touch
  the send paths.
- **ELEC-49** — MEDIUM, FLAGGED. `rollback_election` still does not touch a
  circulated/adopted minutes filing; `minutes_election_filing.py` is
  byte-identical to pass 12, so the gap is unchanged.
- **ELEC-50** — fixed (guard). `tests/test_election_response_viewer_convention.py`
  is unchanged and still passes.

**0 new findings, 0 code fixed by this pass; 1 documentation correction**
(the three items above were fixed by other work before this pass started
and are recorded here as verified, not as this pass's own fixes; ELEC-28
is restored to RESOLVED and the `/ballot/vote/bulk` route's function name
is corrected, both documentation-only).

## Guard tests added (pass 13)

None from this pass. The three fixes landed with their own guard tests
(`test_election_merged_candidate_delete.py`,
`test_election_feature_settings.py`) before this pass began; both re-run
clean below.

## Completion gate (pass 13)

| Check                                                       | Result                                                |
| ----------------------------------------------------------- | ----------------------------------------------------- |
| `flake8 app/ tests/ alembic/`                               | ✅ 0 violations (no Python file changed by this pass) |
| `black --check app/ tests/ alembic/`                        | ✅ 2714 files unchanged                               |
| `isort --check-only app/ tests/ alembic/`                   | ✅ clean                                              |
| `validate_migrations.py --strict`                           | ✅ 667 revisions, single head `b74bcce55c11`          |
| `check_route_permissions.py --strict` (repo root)           | ✅ 279 routes, 0 errors, 0 warnings                   |
| `pytest tests/ -k "election or ballot or minutes_election"` | ✅ 1020 passed, 1 skipped (env-only `py_vapid`)       |
| `cd frontend && npm run typecheck`                          | ✅ 0 errors                                           |
| `cd frontend && npm run lint`                               | ✅ 0 errors, 0 warnings                               |

No source file needed a fix this pass — only this findings file and
`PROGRESS.md` were updated.

## Pass 12 (2026-10-25)

**Scoping.** Step 0 (via GitHub, not the tracker): `search_pull_requests`
(`is:pr is:open head:claude/security-review-`) returned 0 matches,
immediately after PR #3689 (Feature 05, Finance & approvals, pass 12) merged
— confirmed via `pull_request_read` (`merged: true`,
`2026-10-25T13:17:15Z`). Row 05 is `✅`; row 06 (Elections & ballots) is the
next `⬜` row, matching PR #3689's own "Next" note. Checked again
immediately before branching. **Watchdog pickup:** the dedicated review
session (`session_011T1ZyyLrD5HagusgK9uDw2`) was unreachable (`ListAgents`
returned no reachable peer on this machine), the same condition PR #3689's
own write-up recorded a few hours earlier for Feature 05.

**Baseline and delta.** Baseline is pass 11's merge (`da233695`, PR #3564,
2026-10-22). `git diff --stat da233695..origin/main` across the feature's
full established scope — `api/v1/endpoints/elections.py`,
`services/election_service.py`, `services/minutes_election_filing.py`,
`schemas/election.py`, `models/election.py`, `utils/election_ballot_pdf.py`,
`utils/election_pdf_style.py`, `mcp/tools/elections.py`, and
`frontend/src/modules/elections` — is **empty**: not one byte changed in any
of these files since pass 11 merged. The migrations that landed in that
window (`4250eb8b8378` purchase/reimbursement, three directory-account
migrations, NFC card-tap auto-suspend, inventory lot recalls, a
not-null-on-upgrade sweep, a head merge, and date-of-birth/emergency-contact
encryption) touch unrelated tables; none alters any of the 7 election
tables (`saved_ballot_templates`, `elections`, `candidates`,
`voting_tokens`, `votes`, `manual_ballot_batches`,
`manual_ballot_attestations`). **True zero delta.**

**Re-enumeration.** `elections.py` re-walked by AST rather than trusted from
the empty diff alone: **73 routes**, every one carrying a `Depends(...)` in
its signature. The 4 intentionally-public, token-scoped routes are
unchanged at their current lines: `POST /ballot/lookup`
(`lookup_ballot_by_token`, `:667-668`), `POST /ballot/vote`
(`cast_vote_with_token`, `:824-826`), `POST /ballot/vote/bulk`
(`cast_bulk_votes`, `:881.../:2918`), and `GET /{election_id}/verify-receipt`
(`verify_vote_receipt`, `:4805-4809`; the POST variant added for ELEC-14,
`verify_vote_receipt_post`, is now at `:4785-4786`). Every other route is
gated — spot-checked against the permission strings documented across
passes 7-11 (`elections.view` / `elections.manage` / the two OR-gated
self-service read routes), none of which this pass's zero-delta diff could
have touched.

**Verified good (re-confirmed, not re-derived):** the five headline
mechanisms restated in pass 11 — 512-bit tokens hashed at rest (ELEC-5),
anonymous-ballot IP purge at close (ELEC-6), the eligibility gate on
`cast_vote` (ELEC-1), method-aware vote-dedup hash (ELEC-3), and token-write
row locking (ELEC2-5) — plus pass 11's own additions (ranked paper ballots,
IRV counting by `voter_hash`/`voter_id`/`paper_ballot_id`, send-job
org-scoped locking, PDF filename sanitization, auto-filing's org-scoped,
non-raising `capture_election_result` path) are all unchanged, because the
files implementing every one of them are unchanged.

**App-review cross-check (Step 2).** `docs/app-review/elections.md`'s one
still-open item not already mirrored into this file or
`KNOWN_LIMITATIONS.md` is **ELEC2-8** (LOW, `ElectionService.has_user_voted`
has no production caller) — re-verified: still called only from
`tests/test_election_voting_flow.py`, no endpoint or service invokes it.
Unchanged, and out of this rotation's seven dimensions (dead code, not a
security defect); left to the app-review rotation rather than duplicated
here.

**Standing findings re-confirmed unchanged (zero file diff, so unchanged by
construction):**

- **ELEC-12** — fixed (`MAX_SAVED_BALLOT_TEMPLATES_PER_ORG = 200`,
  `elections.py:159`, enforced under a lock at `:566`). Still in place.
- **ELEC-14** — fixed (`POST /{election_id}/verify-receipt` at `:4785`); the
  deprecated `GET` variant (`:4805`) is still kept for external callers.
- **ELEC-16** — accepted as is (owner decision); `list_manual_ballot_batches`
  still has no cap or pagination.
- **ELEC-28** — OPEN. The in-app ballot still cannot render a ballot-item or
  multi-seat contest; converges with W50-10/W50-11. **Correction (pass 13):**
  this re-regressed a pass-9/pass-10 correction without re-reading the
  frontend files; pass 13 re-verified the code directly and restored this
  to RESOLVED — see Pass 13's section.
- **ELEC-40** — FLAGGED. New-ballot collision made unreachable by
  `_validate_ballot_item_identities`; the pre-existing-ballot residual is
  unchanged and still mirrored in `KNOWN_LIMITATIONS.md`.
- **ELEC-48** — LOW, FLAGGED. The synchronous send endpoints still race
  each other with no job-row lock for either side.
- **ELEC-49** — MEDIUM, FLAGGED. `rollback_election` still does not touch a
  circulated/adopted minutes filing; the stale-addendum gap from pass 11 is
  unchanged (`KNOWN_LIMITATIONS.md:3194-3196`).
- **ELEC-50** — fixed (guard). `tests/test_election_response_viewer_convention.py`
  (pass 11's AST guard) is unchanged and still passes.

**0 new findings, 0 fixed this pass** — nothing to fix because nothing in
scope changed. No source file needed a touch; only this findings file and
`PROGRESS.md` were updated.

## Guard tests added (pass 12)

None. No behavior changed, so there is no new class of regression to guard.

## Completion gate (pass 12)

| Check                                                       | Result                                         |
| ----------------------------------------------------------- | ---------------------------------------------- |
| `flake8 app/ tests/ alembic/`                               | ✅ 0 violations (no Python file changed)       |
| `black --check app/ tests/ alembic/`                        | ✅ 2642 files unchanged                        |
| `isort --check-only app/ tests/ alembic/`                   | ✅ clean                                       |
| `validate_migrations.py --strict`                           | ✅ 652 revisions, single head `3f2593e8071e`   |
| `check_route_permissions.py --strict` (repo root)           | ✅ 276 routes, 0 errors, 0 warnings            |
| `pytest tests/ -k "election or ballot or minutes_election"` | ✅ 999 passed, 1 skipped (env-only `py_vapid`) |
| `cd frontend && npm run typecheck`                          | ✅ 0 errors                                    |
| `cd frontend && npm run lint`                               | ✅ 0 errors, 0 warnings                        |

## Pass 11 (2026-10-22)

**Scoping.** Step 0 (via GitHub, not the tracker): `list_pull_requests`
(state=open) returned no `claude/security-review-*` branch. Row 05 had
merged (#3562); row 06 was the next `⬜`. Baseline is pass 10 (#3404);
the delta read in full is paper-ballot ranked entry (`votes.paper_ballot_id`,
migration `59449acab7ba`), ranked-choice counting by paper ballot,
`BallotSendJob` automatic sends, and the new auto-filing of a closed
election's result into its meeting's minutes
(`services/minutes_election_filing.py`).

**Verified good (mechanisms).**

- Ranked paper ballots: `RankedPaperBallot` bounds rankings (1..50, no
  repeats) and count (1..500); `record_manual_ballots` stamps one
  `paper_ballot_id` per ballot, org-scopes the election, and checks every
  ranked candidate belongs to it and has accepted nomination; the id is
  covered by `_sign_vote`, so the hash chain detects tampering with it.
- IRV counting groups rows by `voter_hash`, else `voter_id`, else
  `paper_ballot_id`, else the row id, so a paper ballot is one ballot and
  never merges with another voter's.
- Send jobs: `enqueue_send` / `queue_automatic_send` org-scope the election
  and take the row lock before the active-job read (ELEC-47 holds); job
  errors reach the client through `safe_error_detail`.
- Report/announcement recipients are managers only
  (`_election_report_recipients`); `nominations_announcement` is attached
  only for `elections.manage` viewers.
- PDF routes (`ballot`, `certified-results`, `package-pdf`) are
  `elections.manage`, audited, and build `Content-Disposition` filenames
  from a slug of `[A-Za-z0-9_-]`, so a title cannot inject a header.
- Auto-filing never raises into the close, is org-scoped on both the
  election and the minutes, and goes through `capture_election_result`.

### ELEC-49 — MEDIUM — FLAGGED — A rolled-back election leaves a stale, permanent addendum in circulated minutes

`close_election` (`election_service.py`) now calls `file_closed_election`;
`rollback_election` (`election_service.py`, CLOSED → OPEN) does not touch the
filing. When the meeting's minutes were already circulated or adopted, the
filing is a **permanent addendum** that `remove_election_result` refuses to
delete.

Reproduced with a scratch integration test (removed): close an election with
3 votes at a meeting whose minutes are adopted → addendum filed; roll the
election back, change votes, close again → the second close files nothing
(unique pair minutes/election), and the removal attempt returns 400 "A result
filed after the minutes were circulated is a permanent addendum and cannot be
removed". The adopted minutes keep a result that no longer matches the
election.

Not fixed: whether a rollback should supersede, annotate, or be refused once
its result sits in adopted minutes is a records-integrity policy decision
(it touches the permanence guarantee that circulated minutes carry). Owner
decision recorded in `docs/KNOWN_LIMITATIONS.md`.

### ELEC-50 — LOW — FIXED (guard) — The `viewer` default of `_build_election_response` was an unguarded convention

`viewer=None` means "the route already required `elections.manage`"; a route
reachable by `elections.view` that omitted `viewer` would have exposed the
manager-only announcement with nothing failing. All current callers are
correct. Guard added:
`tests/test_election_response_viewer_convention.py` (AST: every caller
without `viewer=` is gated by `elections.manage` alone).

**Standing findings re-confirmed unchanged:** ELEC-12, ELEC-14, ELEC-16,
ELEC-28, ELEC-40, ELEC-48. **Correction (pass 13):** ELEC-28 was RESOLVED
as of pass 9/10; listing it here as unchanged-and-open re-regressed that
correction without re-reading the frontend files. See pass 13's section.

## Guard tests added (pass 11)

- `tests/test_election_response_viewer_convention.py` (2 tests).

## Completion gate (pass 11)

See the PR body for the gate run; no migration or schema change in this pass.

---

## Pass 9 (2026-10-14)

**Scoping.** Step 0 (via GitHub, not the tracker): `list_pull_requests`
(state=open) and `search_pull_requests` (`is:open head:claude/security-review-`)
both returned no `claude/security-review-*` branch. PR #3225 (Feature 05,
Finance & approvals, pass 9) had merged (`pull_request_read`: `merged: true`,
2026-10-14T19:27:15Z); `PROGRESS.md`'s rotation table already showed row 05
✅, so nothing to clear beyond the Open PR row, which rides into this PR's own
commit. Proceeded to Feature 06, the next `⬜` row.

**Baseline and delta.** Pass 8 merged as `66c7ceb9` (PR #3142,
2026-10-13T01:40:06Z; confirmed an ancestor of current `origin/main` via
`git merge-base`, so the shallow clone's history reaches it). `git diff
--stat 66c7ceb9..origin/main` across the feature's established domain
(`elections.py`, `election_service.py`, `quorum_service.py`,
`models/election.py`, `schemas/election.py`, `utils/election_ballot_pdf.py`,
`mcp/tools/elections.py`, the frontend elections surface, every election-table
migration) found **no new election-table migration** and exactly 4 files with
a real (non-migration) diff: `elections.py` (+4/-2), `schemas/election.py`
(+65/-0), `election_service.py` (+39/-32), `quorum_service.py` (+1/-1,
Meetings & Minutes' own MM-17 fix — unrelated to elections; it only shares
this feature's file list via a `populate_existing` comment cross-reference in
`election_service.py`, confirmed by grep that nothing in `election_service.py`
or `elections.py` actually calls `QuorumService`). The frontend elections
surface (`ElectionBallot.tsx`, `ElectionDetailPage.tsx`,
`BallotVotingPage.tsx`, `electionService.ts`, `types/election.ts`,
`electionHelpers.ts`) has **zero diff** in this window.

**The whole backend delta is PR #3247 ("Fix the last mypy errors and set the
ratchet baseline to zero, batch 6"), read in full rather than trusted from its
title:**

- `elections.py`: `update_election`'s orphaned-position check gains `p is not
None` before comparing — a defensive null-filter, not a behavior change
  (`nominated` already excludes `None` upstream in every path read).
- `election_service.py`: every change is type-narrowing or an
  `Optional`/`Sequence` annotation (`org: Optional[Organization]`,
  `recipient_user_ids: Optional[Sequence[UUID | str]]`,
  `rollback_record: Dict[str, Any]`, …), or threading an already-computed
  value instead of re-reading it off the ORM object a line later
  (`_apply_vote_signature` now returns the signature string it just set on
  `vote.vote_signature`/`vote.signing_key_id`, and all 5 call sites use the
  return value instead of re-reading `vote.vote_signature` — `str(x)` of the
  same value either way, confirmed by reading `_sign_vote`'s return type).
  Two spots add a filter the SQL already guarantees
  (`_recorded_paper_ballot_counts`'s dict comp re-excludes `None` counts after
  a `.is_not(None)` WHERE; `totals_by_batch` skips a `None` batch id) — belt
  and suspenders for mypy, not a behavior change. `candidate_id = str(UUID(choice))`
  (the plain-candidate-UUID branch) was previously a bare `UUID` object while
  the sibling Approve/Deny branches set a `str` (`Candidate.id`) — mypy caught
  a real type inconsistency, but it was functionally inert: both feed
  `_dedup_discriminator`'s f-string and `_create_token_vote`'s string column,
  and `str(uuid_obj) == str(UUID(choice))` for the same input. `
positions_voted` building changed from a list comprehension that could
  append `None` (an absent `ballot_item_id`) to a loop that skips it — the
  one line with a real, if narrow, behavioral delta in this pass, and it
  only removes a `None` that had no legitimate source to begin with (every
  vote dict in `votes` is built from `ballot_item.get("id")` earlier in the
  same function, never literally absent).
- `schemas/election.py`: **new code, not a mypy fix** — `_refuse_cleared()`
  plus `ELECTION_UPDATE_REQUIRED_FIELDS` / `CANDIDATE_UPDATE_REQUIRED_FIELDS`
  reject an explicit `null` on a PATCH for any field whose `elections`/
  `candidates` column is `NOT NULL`, answering 422 before the write reaches
  the database instead of a 500 (`IntegrityError`) or a `TypeError` from
  comparing a null date. This is this codebase's general Pitfall #1
  corollary (explicit `null` vs. omitted key on an update path) applied to
  this feature's own NOT NULL columns; the field lists are kept in sync with
  the model by `test_election_update_null_columns_integration.py` (confirmed
  present and passing — see Completion gate). No new exposure or scoping
  surface: this only narrows what an existing, already-permission-gated PATCH
  will accept.

**Route count unchanged at 69** — this window's diff touches zero route
decorators; re-confirmed by `check_route_permissions.py --strict` below
(269 application-wide, elections' own share unchanged from pass 8's count).
No new migration in this feature's domain (the 20+ new migration files in the
repo-wide diff are all other features — training submissions, RSVP history,
locations grants, event waitlist, public-portal org-nullability, facility
folders, audit-chain sealing, document corrections, expense/budget/restricted
funds, QuickBooks export, skill templates, cash advances — none touch
`elections`/`candidates`/`votes`/`voting_tokens`/`manual_ballot_batches`,
confirmed by grepping each new migration body for those table names).

**ELEC-28 — RESOLVED, correcting pass 7 and pass 8.** Both prior passes
re-cited `ElectionBallot.tsx:60-78`'s `getPositions()`/
`getCandidatesForPosition()` as unchanged. Reading the file directly this
pass: those functions do not exist. The component's own docstring states
the fix in the past tense ("It used to be built from `election.positions`
alone... (W50-10, ELEC-28)") and the body reads `ballot_items` off
`GET /elections/{id}/ballot`'s response, rendering through the shared
`BallotItemCard` — the same component the emailed ballot uses
(`BallotItemCard.tsx`'s own docstring: "Rendered by both the emailed ballot
and the in-app Cast Vote tab"). `BallotItemCard.tsx` caps a multi-select at
`settings.max_votes_per_position` (`ballotChoices.ts:87`) and names the seat
count when `seats_per_position > 1` (`BallotItemCard.tsx:129`) — the exact
two gaps W50-10/W50-11 and ELEC-28 described. This is not a pass-9 fix: it
was already landed, and already correctly recorded as fixed in this file's
own **Owner decisions applied (2026-10-05)** section ("ELEC-28 / W50-10 ...
fixed: one ballot model") — the same date pass 7 ran. Pass 7 and pass 8 each
re-asserted the pre-fix state without re-reading the current file, a gap this
pass closes by adding an inline correction to both their findings blocks
(above) rather than rewriting history. **ELEC-28/W50-10/W50-11 move to
RESOLVED**, closing this file's one remaining OPEN item from the §-rendering
class (ELEC-12 and ELEC-16 are FLAGGED/accepted, not OPEN, and ELEC-40 is
FLAGGED).

**Standing items re-verified, unchanged:**

- **ELEC-12** (`SavedBallotTemplate` list/create unbounded) — untouched by
  this window's diff; still bounded in practice by the unchanged 200/org
  creation cap.
- **ELEC-16** (`list_manual_ballot_batches` unbounded) — `election_service.py`'s
  `list_manual_ballot_batches` (line 5196) is outside every hunk this
  window's diff touches; accepted as-is per the Owner Decisions section.
- **ELEC-40** (pre-ELEC-34 dedup collision-avoidance edge case) —
  `_dedup_position_key`/`_dedup_scoped_item_aliases` (`election_service.py:286,353`)
  are outside every hunk this window's diff touches.

**0 new findings; 0 code fixed by this pass** — ELEC-28's resolution was
discovered, not made, by this pass; the mypy/null-safety delta needed no
further fix; the new `_refuse_cleared` hardening was already landed and
tested by the PR that added it.

## Schema & migration notes (pass 9)

No election-table migration landed since pass 8's baseline (confirmed above
by grepping every new migration body added in this window for the feature's
five table names — none matched).

## Guard tests added (pass 9)

None. `test_election_update_null_columns_integration.py` already guards the
new `_refuse_cleared` validators (added by the PR that introduced them, not
this pass); ELEC-28's resolution is already guarded by
`tests/test_ballot_convergence.py` (cited in the Owner Decisions section)
and the frontend's `ElectionBallot.w50-receipt.test.tsx` / ballot component
tests — adding a duplicate here would test the same invariant twice.

## Completion gate (pass 9)

| Check                                                                      | Result                                              |
| -------------------------------------------------------------------------- | --------------------------------------------------- |
| `flake8 app/ tests/ alembic/`                                              | ✅ 0 violations                                     |
| `black --check app/ tests/ alembic/`                                       | ✅ 2292 files unchanged                             |
| `isort --check-only app/ tests/ alembic/`                                  | ✅ clean                                            |
| `python3 scripts/validate_migrations.py --strict`                          | ✅ 594 revisions, single head `252c7517d80a`        |
| `python3 scripts/check_route_permissions.py --strict` (repo root)          | ✅ 269 routes, 0 errors, 0 warnings                 |
| `pytest tests/ -q -k "election or ballot or quorum or candidate or proxy"` | ✅ 976 passed, 1 skipped (pre-existing, `py_vapid`) |

No application code was changed this pass — the gate confirms the mypy-driven
delta since pass 8 left the codebase clean; `npm run typecheck`/`npm run lint`
were not re-run since the frontend elections surface has zero diff in this
window (per CLAUDE.md's "Match the Verification to the Change").

---

## Pass 10 (2026-10-18)

**Scoping.** Step 0 (via GitHub, not the tracker): `list_pull_requests`
(state=open) returned no `claude/security-review-*` branch, and the dedicated
`/loop 30m /security-review` session was not reachable (`ListAgents`) — a
watchdog pickup. PR #3401 (Feature 05, Finance & approvals, pass 10) had
already merged; `PROGRESS.md`'s rotation table already showed row 05 ✅, so
nothing to clear beyond the Open PR row, which rides into this PR's own
commit. Proceeded to Feature 06, the next `⬜` row.

**Baseline and delta.** Pass 9 merged as `80d92def` (PR #3248,
2026-10-14T19:5x UTC; confirmed an ancestor of `origin/main` via
`git merge-base --is-ancestor`). `git diff --stat 80d92def..origin/main`
across the feature's established domain found, this time, a real change: a
new background-job system for ballot/reminder sends (`app/services/
ballot_send_jobs.py`, new — 538 lines; two new migrations creating and then
extending `ballot_send_jobs`; `elections.py` +248/-156; `models/election.py`
+96; `schemas/election.py` +20; `election_service.py` +158/-30; the frontend
elections surface's `ElectionDetailPage.tsx`/`ElectionsPage.tsx` for polling
and meeting-window alignment). This is substantive, so it was read in full
rather than diffed line-by-line against pass 9's (nonexistent) prior art.

**What the feature does and why.** Emailing ballots to a whole department
(minting one voting token per member, one SMTP send per message, a pause
between messages) ran inside the HTTP request and outlasted the browser's
30-second timeout — and nginx's 60-second proxy timeout — at around forty
members, while the server kept sending anyway; the secretary saw a failure
and was invited to send again, mailing every member a second link.
`POST /{election_id}/ballot-send-jobs` and `POST /{election_id}/
reminder-send-jobs` now record a `BallotSendJob` row and return `202` at
once; the send runs after the response as an `asyncio.create_task` kept in a
module-level strong-reference set (`_running_tasks`, so the task cannot be
garbage-collected mid-flight — asyncio itself holds only a weak reference),
opening its own DB session via `async_session_factory` (correctly, since the
request's session is closed by the time the task runs). The synchronous
`POST /{election_id}/send-ballot` and the pre-existing remind-non-voters path
are kept (API callers, and parity for anything not yet moved to polling) and
now share the exact same `perform_ballot_send`/`perform_reminder_send`
functions, so both report identically.

**Verified sound:**

- **Org scoping (checklist §14a/14b).** Every query in `ballot_send_jobs.py`
  filters `organization_id` — `find_active_job`, `get_job` (also filters
  `election_id`, so a job cannot be read through a different election's url),
  `_load_job`, and `_run_job`'s own re-fetch of the `Election` row. The queued
  endpoint (`_queue_send` in `elections.py`) resolves the election through an
  org-scoped, locked `select` before ever touching a job row — the correct
  shape, and the one `get_ballot_send_job_endpoint` also follows.
- **The migrations** (`c87efd81c5aa`, `244b0fd07205`) are both guarded on
  their parent tables existing (pitfall #26) and the column not already
  present; `requested_by` is `ForeignKey(..., ondelete="SET NULL")` with
  `nullable=True` (pitfall #2); `organization_id`/`election_id` are
  `ondelete="CASCADE"`, not nullable, matching the model.
- **The server-configured `FRONTEND_URL`**, never the client `Host` header,
  still builds every ballot/reminder link (`_ballot_base_url`,
  `_reminder_ballot_url`) — unchanged from pass 9's own review of this
  invariant, now centralized rather than duplicated.
- **The permission gate** (`elections.manage`) is unchanged and applied to
  all three new routes.
- **W50-91** (new, FIXED on arrival): `send_ballot_emails` now refuses to
  queue a send for an election with no ballot items and no plain positions
  before it does any work — previously such a send mailed working-looking
  links to a ballot with nothing to vote on.

### ELEC-47 — MEDIUM — the one-send-per-election guard was a plain read behind an already-fixed snapshot, so two concurrent requests could both queue a send — 🔧 FIXED (this pass)

**File:** `backend/app/services/ballot_send_jobs.py:344-368` (`find_active_job`),
called from `elections.py`'s `_queue_send` (and from `send_ballot_emails` /
`remind_non_voters`).

**This module's own docstring states the invariant it needs:** "two
overlapping sends mail every member twice, and each writes the election's
record of who was sent a ballot from what it read when it started, so
whichever finishes last overwrites the other's" — and `_queue_send`'s comment
says the fix is "Locked so two requests arriving together cannot both find no
job in progress and both queue one." The lock it takes is real
(`select(Election)...with_for_update()`), but this is CLAUDE.md pitfall #27's
exact shape ("Lock the parent, not the rows being counted... make the count
itself a locking read... every one of these checks runs behind an endpoint
that already loaded the parent, so the snapshot predates the lock"):
`current_user: User = Depends(require_permission(...))` resolves through
`get_current_user` → `AuthService(db).get_user_from_token(token)`, a plain
read on the **same session** (FastAPI caches `Depends(get_db)` per request)
that runs _before_ the endpoint body — so it is this transaction's actual
first read, fixing its REPEATABLE READ snapshot before `_queue_send`'s own
`with_for_update()` on `Election` ever executes. `find_active_job`'s
`select(BallotSendJob)...` (no `with_for_update()`) is therefore a plain,
non-locking read: it answers from that pre-existing snapshot regardless of
which row the election lock just waited on.

**Failure scenario:** two requests to `POST /{election_id}/ballot-send-jobs`
for the same election arrive close together (a double-click, or two admins).
Both resolve `current_user` first (fixing each transaction's snapshot before
either reaches the election lock). Request A acquires the `Election`
row lock, finds no active job, creates and commits a `BallotSendJob`, and
releases the lock. Request B's own lock acquisition was blocked until A
committed, so B now holds the lock and calls `find_active_job` — but B's
snapshot was fixed (by B's own auth lookup) before A's commit, so the plain
SELECT does not see A's new row. B also finds "no active job", creates a
second `BallotSendJob`, and both run: every member is mailed twice with two
different voting tokens, and whichever job's `send_ballot_emails` call
finishes last silently overwrites the election's `email_sent`/
`email_recipients` record of who was sent a ballot — the exact outcome this
module exists to prevent. The same gap applies to `remind_non_voters`
racing a queued send, and to two concurrent `/send-ballot` or
`/remind-non-voters` calls racing each other through the same stale-read
path (see the FLAGGED item below for the part this fix does not reach).

**Fix:** `find_active_job`'s query now ends in `.with_for_update()`. A
locking read always reads the latest committed row for the table it locks,
regardless of the transaction's existing snapshot, so once `_queue_send`'s
election lock is granted (necessarily after the first request committed),
this read correctly sees the job the first request just created. No
behavior change in the non-racing case — same rows, same ordering, now read
with a row lock that (for this table) nothing else contends for.

**Guard:** `db_session`'s single auto-rolled-back transaction per test cannot
exercise a genuine two-connection race (the same limitation
`test_capacity_locking.py`'s own docstring notes), so
`TestFindActiveJobLocksTheRead::test_the_query_is_a_locking_read` in
`tests/test_ballot_send_jobs.py` instead asserts the query shape directly —
`statement._for_update_arg is not None` on the captured `Select`, the same
pattern `test_application_self_withdraw.py` and `test_capacity_locking.py`
use for this exact class of invariant.

### ELEC-48 — LOW — the synchronous send endpoints still race each other directly, with no job row for either side to lock against — 🚩 FLAGGED (new finding, owner decision needed)

**File:** `backend/app/api/v1/endpoints/elections.py` — `send_ballot_emails`
(≈3007-3053) and `remind_non_voters` (≈3401-3435).

ELEC-47's fix closes the race for the **queued** path (`_queue_send`), which
already took an `Election` row lock before deciding. The two **synchronous**
endpoints take no lock of their own: `send_ballot_emails` reads `Election`
with a plain `select` (no `with_for_update()`), and `remind_non_voters`'s
endpoint body does not read `Election` at all before calling
`find_active_job` (the service method it eventually calls does, also
unlocked). Two concurrent calls to the _same_ synchronous endpoint, with no
`BallotSendJob` row yet for either to find or lock against, both pass
`find_active_job`'s check (locking or not — there is nothing to lock) and
both send inline, which is the identical double-mail/overwritten-
`email_sent`-record outcome ELEC-47 describes.

This is not a regression this pass introduced: before `BallotSendJob`
existed, these two endpoints had no overlap guard of any kind, so this is a
narrowing of a pre-existing gap (now closed only against the new queued
path) rather than a widening of one. Closing it fully means giving the two
synchronous endpoints the same `Election`-row lock `_queue_send` takes — a
larger, deliberate change to two long-lived endpoints' locking behavior that
a correctness-only fix pass shouldn't make unannounced, and one the owner may
prefer to resolve differently (e.g. retiring the synchronous endpoints in
favor of the job queue now that both exist, rather than adding locking to
code on its way out). Recorded in `docs/KNOWN_LIMITATIONS.md`.

**Standing items re-verified, unchanged:**

- **ELEC-12** (`SavedBallotTemplate` list/create unbounded) — untouched by
  this window's diff; still bounded by the unchanged 200/org creation cap.
- **ELEC-16** (`list_manual_ballot_batches` unbounded) — outside every hunk
  this window's diff touches; accepted as-is per the Owner Decisions section.
- **ELEC-40** (pre-ELEC-34 dedup collision-avoidance edge case) —
  `_dedup_position_key`/`_dedup_scoped_item_aliases` are outside every hunk
  this window's diff touches.
- **ELEC-14, ELEC-28/W50-10/W50-11** — resolved in prior passes; this
  window's diff does not touch any of the files those resolutions live in.

**1 fix applied (ELEC-47), 1 new finding flagged (ELEC-48).**

## Guard tests added (pass 10)

- `tests/test_ballot_send_jobs.py::TestFindActiveJobLocksTheRead` — asserts
  `find_active_job`'s statement carries a `FOR UPDATE` lock, guarding ELEC-47
  against reintroduction.

## Completion gate (pass 10)

| Check                                                                                                                       | Result                                              |
| --------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| `flake8 app/ tests/ alembic/`                                                                                               | ✅ 0 violations                                     |
| `black --check app/ tests/ alembic/`                                                                                        | ✅ clean                                            |
| `isort --check-only app/ tests/ alembic/`                                                                                   | ✅ clean                                            |
| `python3 scripts/validate_migrations.py --strict`                                                                           | ✅ 618 revisions, single head `1117b642643b`        |
| `python3 scripts/check_route_permissions.py --strict` (repo root)                                                           | ✅ 270 routes, 0 errors, 0 warnings                 |
| `pytest tests/test_ballot_send_jobs.py -q`                                                                                  | ✅ 16 passed                                        |
| `pytest tests/ -q -k "election or ballot or quorum or candidate or proxy" -m "not integration and not slow and not docker"` | ✅ 599 passed, 1 skipped (pre-existing, `py_vapid`) |
| `pytest tests/test_ballot_send_jobs.py -q -m "integration or unit"`                                                         | ✅ 16 passed (against the real database)            |

`npm run typecheck`/`npm run lint` were not re-run: this pass's only code
change is the one-line backend locking fix and its test; the frontend
elections surface's own diff since pass 9 (polling, meeting-window
alignment) was merged and CI-tested by the PR that introduced it, and is
unchanged by this pass (per CLAUDE.md's "Match the Verification to the
Change").

---

## Pass 8 (2026-10-12)

**Scoping.** Step 0 (via GitHub, not the tracker): `list_pull_requests`
(open) and `search_pull_requests` (`is:open head:claude/security-review-`,
0 results) confirmed no `claude/security-review-*` PR was in flight. PR
#3137 (Feature 05, Finance & approvals, pass 8, watchdog pickup) had
already merged (`pull_request_read`: `merged: true`,
2026-10-12 23:00:53 UTC); `PROGRESS.md`'s Open PR row still named it, so it
was cleared and Feature 06 marked 🔄 in the working tree per Step 0/1 —
ridden into this PR's own commit rather than committed separately. This
iteration was itself a watchdog pickup: the dedicated `/loop 30m
/security-review` session had gone quiet after #3137 merged, with the
tracker a step behind on GitHub's own state.

**Baseline.** Diffed pass 7's closing merge (`3d4d6b14`, PR #2947) against
current `HEAD` across the feature's full domain (`elections.py`,
`election_service.py`, `models/election.py`, `schemas/election.py`, the
elections frontend module, and every election-table migration): 71 files,
9,852 insertions / 576 deletions — the diff touches the service file alone
by +2,280 lines. Read as a real delta, not sampled: a fresh scripted diff
of route decorators found **4 new routes** (69, up from 65 — `GET`/`POST
/{election_id}/ballot`, `GET /{election_id}/ballot/proxies`, `POST
/{election_id}/verify-receipt`); every new top-level service method the
diff added was read in full (`get_member_ballot`, `submit_member_ballot`,
`get_my_proxy_authorizations`, `_active_proxy_authorization`,
`_sign_vote`/`_apply_vote_signature`/`_legacy_vote_signing_key`/
`vote_signing_key_id`/`_vote_key_cutover`, `_declare_seat_winners`,
`_token_voter_id`, `set_candidate_acceptance`/`respond_to_nomination`/
`after_acceptance_on_behalf`), not merely diffed against their callers'
comments.

**New surface, verified sound:**

- **In-app ballot self-service** (`GET`/`POST /{election_id}/ballot`,
  `GET /{election_id}/ballot/proxies`) — the emailed ballot's submission
  shape, now also reachable signed-in. `get_current_user`-gated only (no
  `elections.*` permission, by design — it is the voter's own ballot), and
  correctly self-scoped: `submit_member_ballot` row-locks the election
  (`.with_for_update()`) before delegating each selection to the same
  `cast_vote`/`cast_proxy_vote` path every other in-app vote uses
  (`commit=False`, one refused selection rolls back the whole ballot — a
  real `IntegrityError` path is also caught and rolled back, W50-6's dedup
  race). The `proxy_authorization_id` a caller may pass is validated by
  `_active_proxy_authorization` against `auth["proxy_user_id"] ==
str(current_user.id)` before anything is read or written — closing the
  obvious IDOR this parameter would otherwise open (a member voting a
  ballot they hold no proxy for). `get_my_proxy_authorizations` mirrors
  the same org/election scoping and additionally gates on the
  organization's proxy-voting setting and the proxy's own anonymity
  acknowledgment (`_proxy_anonymity_error`).
- **`POST /{election_id}/verify-receipt`** carries the receipt hash in the
  body instead of the query string, with the `GET` form kept (`deprecated:
true`, a `Deprecation` header and a `Link` to the successor) for external
  callers written against the documented GET. The frontend
  (`electionService.ts:716-717`) already calls the POST form. **This
  resolves ELEC-14** — see below.
- **Vote-signing key rotation** (`VOTE_SIGNING_KEY` config,
  `signing_key_id` column, migration `01f36743137a`) — votes sign with a
  dedicated key (falling back to `SECRET_KEY` with a startup warning when
  unset), and `verify_vote_integrity` accepts a vote signed with the prior
  key only up to the first ballot signed with the new one
  (`_vote_key_cutover`), so `SECRET_KEY` cannot become a silent permanent
  second key. The key fingerprint recorded on each vote
  (`vote_signing_key_id`) is itself an HMAC of a fixed label — it
  identifies the key without revealing it. Signature comparison uses
  `hmac.compare_digest` throughout (timing-safe), unchanged from prior
  passes.
- **Multi-seat tallying** (`seats_per_position`, migration `8c4f2a6e1d93`,
  `_declare_seat_winners`) — this is the W50-11 fix (a "(2 seats)" race
  previously declared one winner). Pure tally computation over an
  already-fetched result set, no by-id or tenancy surface of its own; ties
  on the last seat are flagged (`is_tied`) and resolved by the election's
  existing `tie_policy`, the same mechanism a one-seat tie already used.
  Not re-litigated as a §1-6 finding — it is correctness/tally logic the
  2026-09-30 workflow review (W50-11) already owns, and nothing here
  touches auth, tenancy, injection, exposure or abuse surface.
- **Results-revision stamps** (`results_revisions` JSON column, migration
  `5b1e7d3c9a42`, `_record_results_revision`) and **candidate
  accepted-on-behalf labeling + nominations-closed slate freeze**
  (migration `7adc810c57f9`, `set_candidate_acceptance`,
  `after_acceptance_on_behalf`, `elections.nominations_closed_at`) are the
  already-landed ELEC-45/W50-9 and ELEC-46/W50-38 fixes this file's Owner
  Decisions already record resolved. Re-verified directly against the
  current code rather than trusted from the prior write-up:
  `update_candidate` (`elections.py:2431-2563`) now routes `accepted`
  through `service.set_candidate_acceptance`, which refuses once
  `nominations_closed_at` is set (slate frozen), and an on-behalf
  acceptance (`previous["accepted"] is False and candidate.accepted and
candidate.accepted_on_behalf_by is not None`) triggers
  `after_acceptance_on_behalf` (audit event + notification) — matches the
  resolution text exactly, both fixes hold.
- **`voting_tokens.user_id`** (migration `edb445ae5806`, W50-3) — set only
  via `record_user_id=not election.anonymous_voting` at the single call
  site (`election_service.py:8335`); `_token_voter_id` additionally
  hard-codes `if election.anonymous_voting: return None` before looking at
  either the column or a hash-matched fallback, so an anonymous election's
  link votes cannot become attributable through this column regardless of
  what is stored on the token. No privacy regression of the ELEC-43 shape.
- All five new election-table migrations are idempotent, guard the
  `create_all`-only tables (`elections`, `candidates`, `voting_tokens` all
  predate Alembic and are skipped when absent), and the two new FKs
  (`voting_tokens.user_id`, `candidates.accepted_on_behalf_by`) are both
  `ondelete="SET NULL"` with `nullable=True` (Pitfall #2). `/elections`
  (no trailing slash) already covers every new sub-route in
  `UNCACHEABLE_PREFIXES` (`frontend/src/utils/apiCache.ts:69`) — checked
  directly, not assumed.

**ELEC-14 — RESOLVED.** `verify_vote_receipt`'s credential moved off the
query string onto a POST body (`VoteReceiptVerifyRequest.receipt`); the
GET form survives only for undocumented external callers, marked
deprecated with the headers above. Frontend already migrated
(`electionService.ts`, `VerifyReceipt.tsx`). No `KNOWN_LIMITATIONS.md`
entry existed for this one (it was FLAGGED, not an owner-decision item),
so nothing to remove there.

**Standing items re-verified, unchanged:**

- **ELEC-12** (`SavedBallotTemplate` list/create unbounded) —
  `list_saved_ballot_templates` (`elections.py:488-498`) still has no
  `.limit()`/pagination; practically bounded by the existing
  `MAX_SAVED_BALLOT_TEMPLATES_PER_ORG = 200` creation cap
  (`elections.py:136,530`, unchanged, predates this window), which is
  exactly why this stays LOW/MED rather than unbounded-growth HIGH.
- **ELEC-16** (`list_manual_ballot_batches` unbounded) —
  `election_service.py:5189-5203` (shifted from pass 7's `4411-4440`)
  still has no cap; accepted as-is per the Owner Decisions section above
  (paper-tally sessions per election are naturally few).
- **ELEC-28** (in-app ballot cannot render a ballot-item/multi-seat
  contest) — grepped `ElectionBallot.tsx`'s `getPositions()`/
  `getCandidatesForPosition()`: still iterates only `election.positions`.
  Converges with W50-10/W50-11; W50-11's half (seat count) is now fixed in
  the tally (see above), but the in-app tab's rendering gap itself is
  unchanged and still awaits the owner's rewrite-or-hide decision.
  **Correction (pass 9, 2026-10-14): this bullet was wrong when written.**
  `ElectionBallot.tsx` had already been rewritten onto the shared
  `ballot_items` model earlier in this same window — it is exactly the "one
  ballot model" fix this file's own **Owner decisions applied (2026-10-05)**
  section records as fixed, above. The `getPositions()`/
  `getCandidatesForPosition()` functions this bullet cites did not exist in
  the code this pass was reviewing; see Pass 9 below.
- **ELEC-40** (pre-ELEC-34 dedup collision-avoidance edge case) —
  `_dedup_position_key`/`_dedup_scoped_item_aliases` (`election_service.py:286-375`,
  shifted from pass 7's `146-240`) are unchanged by this window's diff;
  confirmed none of the 2,280 changed lines falls inside either function.

**0 new findings; 0 code fixed by this pass directly** — the one
resolution (ELEC-14) was already landed on `main` by other work, re-found
and recorded here rather than re-fixed.

## Pass 7 (2026-10-05)

**Scoping.** Step 0 (via GitHub, not the tracker): `list_pull_requests` (open)
returned only dependabot PRs and unrelated app-review/feature PRs (#2946,
#2945, #2944, #2943, #2942, #2936, #2931, #2929, #2928, #2918, #2910) — no
`claude/security-review-*` branch. PR #2941 (Feature 05, Finance & approvals,
pass 7) had already merged; its record was cleared and Feature 06 marked 🔄 in
the working tree per Step 0/1 (ridden into this PR's commit, not committed
separately). Proceeded to Feature 06.

**Baseline and an honest limit on how far back the diff reaches.** This
session's git history is a shallow clone (858 commits) that does not reach PR
#2600's own base commit (`7754eccd7`, 2026-09-15) or its merge commit — both
are outside the fetched window, and a `git fetch --depth=2000` attempt timed
out. The oldest commit in reachable history that already contains pass 6's
one-line change is `0b52e56aa` (2026-09-23), so that commit is used as the
practical diff baseline below; it understates the window by about a week,
but every commit pass 6 itself reviewed is included in it, so nothing in that
earlier week is re-litigated twice and nothing is silently skipped — the gap
only means a textually smaller diff than pass-6-to-now would show, not a gap
in coverage.

`git diff --stat 0b52e56aa..HEAD` across the feature's established domain:
2,090 insertions / 792 deletions across `elections.py` (+441/-), `models/
election.py` (+59/-), `schemas/election.py` (+101/-), `election_service.py`
(+2,237/-, the largest single-feature diff this file has ever swept in one
pass), `utils/election_ballot_pdf.py` (+44/-), plus the entire frontend
elections surface and 4 election-table migrations. **This is not drift from
unrelated work landing nearby** (the shape pass 6 and earlier passes read
through) — it is a dedicated, 1,207-line workflow review of this exact
feature, `docs/workflow-review/W50-elections.md`, driven twice
(2026-09-30) end to end through the browser and the API as `secretary`,
`member`, `admin`, `treasurer`, `training_officer` and two anonymous token
voters, covering vote integrity, tenant/permission boundaries, and 82
numbered findings (W50-1…W50-82) — six of which were specifically what this
checklist calls CRITICAL/HIGH-severity voting-integrity defects. All six are
confirmed landed on `main` in this history (commits `3de83db8`, `7aa34054`,
`d6f828c3`, `06c3d560`, `cbd97eb3`), each with its own regression test, and
several were re-driven live against the fix with the SMTP sink reading every
mail before being marked confirmed in that file.

**This pass's job was therefore not to re-find what W50 already found**, but
to (1) independently re-verify, from the security checklist's own lens
(auth/authz/tenant-isolation/injection/exposure/abuse/schema — not W50's
workflow-correctness lens), that the landed fixes are sound and introduce no
new cross-tenant or exposure gap; (2) do a full fresh route enumeration,
since a diff this large in the feature's most security-critical file
warrants one rather than trusting pass 6's count; (3) re-verify the 5
standing ELEC findings; and (4) fold the W50 items that land inside this
checklist's seven dimensions into this file's own numbered ledger, so a
future ELEC-06 pass does not have to cross-reference a differently-scoped
review's file to know this feature's full open-security-finding set.

### Route inventory — 65 routes, fresh enumeration (unchanged from pass 6)

Enumerated by script (every `@router.get/post/put/patch/delete` in
`elections.py`, its full decorator+signature block parsed for
`require_permission(...)` and `Depends(get_current_user)`), not spot-checked.
Counts: **57 permission-gated**, **4 authenticated-only** (no permission
beyond login — each does its own eligibility/self-scoping, the established
pattern since ELEC-1), **4 intentionally public** (a voting token or a
receipt hash is the compensating control). 65 total, matching pass 6's count
exactly — confirming the 2,237-line service diff and 441-line endpoint diff
added **zero new routes**; every line landed inside already-declared handlers.

| Method            | Path                                                                             | Gate                                   | Org-scoped via                                                                                                                        |
| ----------------- | -------------------------------------------------------------------------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| GET               | `` (list)                                                                        | `elections.view`                       | `Election.organization_id` filter                                                                                                     |
| POST              | `` (create)                                                                      | `elections.manage`                     | stamped from `current_user.organization_id`; `meeting_id`/`event_id` validated in-org by `_validate_election_links` → `assert_in_org` |
| GET               | `/templates/ballot-items`                                                        | `elections.manage`                     | n/a (static template catalog, no DB read)                                                                                             |
| GET               | `/templates/saved-ballots`                                                       | `elections.manage`                     | `SavedBallotTemplate.organization_id` filter — **ELEC-12: unbounded, re-verified below**                                              |
| POST              | `/templates/saved-ballots`                                                       | `elections.manage`                     | stamped from caller's org                                                                                                             |
| DELETE            | `/templates/saved-ballots/{id}`                                                  | `elections.manage`                     | org filter in the delete's own `WHERE`                                                                                                |
| POST              | `/ballot/lookup`                                                                 | **public**                             | token → `get_ballot_by_token` resolves the election from the token's own `election_id`; rate-limited 10/min/IP                        |
| POST              | `/ballot/vote`                                                                   | **public**                             | token-scoped, same mechanism; rate-limited 5/min/IP                                                                                   |
| POST              | `/ballot/vote/bulk`                                                              | **public**                             | token-scoped, same mechanism; rate-limited 5/min/IP                                                                                   |
| GET/PATCH         | `/settings`                                                                      | `elections.manage`                     | org row, singleton per org                                                                                                            |
| GET               | `/{election_id}`                                                                 | `elections.view`                       | `service.get_election(id, org)`                                                                                                       |
| PATCH             | `/{election_id}`                                                                 | `elections.manage`                     | same                                                                                                                                  |
| DELETE            | `/{election_id}`                                                                 | `elections.manage`                     | same — **re-verified below (W50-1 cascade fix)**                                                                                      |
| POST              | `/{election_id}/open` \| `/close` \| `/open-nominations` \| `/close-nominations` | `elections.manage`                     | same                                                                                                                                  |
| POST              | `/{election_id}/nominations` \| `/accept` \| `/decline`                          | `elections.view`                       | election resolved org-scoped first; nominee self-check (except the manager-accept gap, W50-38, flagged below as ELEC-46)              |
| POST/GET          | `/{election_id}/manual-ballots*`, `/attest`, `/void`                             | `elections.manage`                     | election resolved org-scoped first — **ELEC-16: unbounded list, re-verified below**                                                   |
| POST              | `/{election_id}/clone`                                                           | `elections.manage`                     | source election org-scoped; clone stamped same org                                                                                    |
| POST              | `/{election_id}/write-ins/merge`                                                 | `elections.manage`                     | candidate ids resolved via `election_id IN` scoped to the already-org-scoped election                                                 |
| GET               | `/{election_id}/printable-ballot` \| `/certified-results`                        | `elections.manage`                     | same                                                                                                                                  |
| POST              | `/{election_id}/rollback`                                                        | `elections.manage`                     | same                                                                                                                                  |
| GET               | `/{election_id}/candidates`                                                      | `elections.view` OR `elections.manage` | org-scoped via election; OR-gate widened pass 6, body-level `include_pending` branch unchanged (re-confirmed)                         |
| POST/PATCH/DELETE | `/{election_id}/candidates*`                                                     | `elections.manage`                     | election resolved org-scoped first (ELEC-2's fix, still intact)                                                                       |
| GET               | `/{election_id}/eligibility`                                                     | authenticated only                     | self-scoped to `current_user.id`                                                                                                      |
| POST              | `/{election_id}/vote` \| `/vote/bulk`                                            | authenticated only                     | self-scoped; eligibility gate (ELEC-1) intact                                                                                         |
| GET               | `/{election_id}/results`                                                         | `elections.view`                       | election org-scoped; **ELEC-44 cross-ref below (recipient/count exposure)**                                                           |
| GET               | `/{election_id}/stats`                                                           | `elections.manage`                     | same                                                                                                                                  |
| POST              | `/{election_id}/send-ballot` \| `/send-report` \| `/send-package`                | `elections.manage`                     | same; recipient resolution org-filters `User.organization_id` (W50-33 fix, re-verified below)                                         |
| GET               | `/{election_id}/package-recipients` \| `/package-pdf`                            | `elections.manage`                     | same                                                                                                                                  |
| GET               | `/{election_id}/non-voters`                                                      | `elections.manage`                     | same                                                                                                                                  |
| POST              | `/{election_id}/remind-non-voters`                                               | `elections.manage`                     | same                                                                                                                                  |
| GET               | `/{election_id}/eligibility-roster` \| `/integrity` \| `/forensics`              | `elections.manage`                     | same                                                                                                                                  |
| DELETE            | `/{election_id}/votes/{vote_id}`                                                 | `elections.manage`                     | **election- and org-scoped in the same query** (W50-39 fix, re-verified below)                                                        |
| GET               | `/{election_id}/attendees`                                                       | `elections.view`                       | same                                                                                                                                  |
| POST/DELETE       | `/{election_id}/attendees*` \| `/import-meeting-attendees`                       | `elections.manage`                     | same; meeting id validated in-org                                                                                                     |
| POST/GET/DELETE   | `/{election_id}/voter-overrides*`                                                | `elections.manage`                     | same                                                                                                                                  |
| POST/GET/DELETE   | `/{election_id}/proxy-authorizations*`                                           | `elections.manage`                     | delegating/proxy/authorized-by ids resolved via org-scoped `User` lookups (re-confirmed, unchanged since pass 6)                      |
| POST              | `/{election_id}/proxy-vote`                                                      | authenticated only                     | self-scoped to the caller as the proxy holder; **ELEC-43 cross-ref below (anonymity residual)**                                       |
| POST              | `/{election_id}/send-test-ballot`                                                | `elections.manage`                     | same                                                                                                                                  |
| GET               | `/{election_id}/preview-ballot`                                                  | `elections.manage`                     | same                                                                                                                                  |
| GET               | `/{election_id}/verify-receipt`                                                  | **public**                             | receipt hash only, no roster/vote-content disclosure; **ELEC-14: GET query param, re-verified below**; rate-limited 10/min/IP         |

### Verified good ✅ (this pass)

- **Every by-id query re-read this pass resolves through an org-scoped
  election first**, including every line the 2,237-line service diff
  touched that this pass read directly: `soft_delete_vote`
  (`election_service.py:2185-2224`, now additionally election-scoped per
  W50-39 — a vote from another election under the path's election_id
  resolves to "not found" rather than being voided through the wrong
  election's URL), `delete_election`
  (`elections.py:1314-1320`, `service.get_election(id, org)` before any
  mutation, runoff-child and cascade handling added by W50-1 without
  touching the org gate), `get_election_forensics`
  (`election_service.py:2260-2267`), `closed_by_name`
  (`election_service.py:3554-3569`, the officer-name join added for W50-14
  filters `User.organization_id == election.organization_id`), and
  `_build_ballot_recipient_lists` (`election_service.py:8113-8152`, the
  recipient-name join added for W50-33 filters `User.organization_id`).
  No new unscoped by-id read introduced by this window's changes.
- **The W50-1 cascade fix does not weaken tenant isolation.**
  `VotingToken.election` now cascades (`cascade="all, delete-orphan",
passive_deletes=True`, `models/election.py:451-456`) instead of nulling a
  NOT NULL FK at delete time — a correctness fix for MySQL error 1048, not
  a scoping change; the delete path's own org check (above) is unchanged.
- **The four new/changed election-table migrations are schema-sound**
  (Pitfall #2/#26 compliant — see Schema & migration notes below); none
  introduces an unguarded `create_all`-only table touch or a non-nullable
  `SET NULL` column.
- **No new injection surface.** No `.like()`/`.ilike()` call exists
  anywhere in `elections.py` or `election_service.py` (confirmed by grep,
  0 hits) — the feature has no free-text search, so Pitfall #25 is n/a,
  unchanged since pass 1.
- **The public rate-limit wrappers (ELEC-41/42) are still genuinely
  awaited** (`_ballot_read_rate_limit`/`_ballot_vote_rate_limit`,
  `elections.py:124-153`, both `return await check_rate_limit(...)`) and
  are wired on all 4 public routes, confirmed above in the route table.
- **W50's six CRITICAL/HIGH voting-integrity fixes hold on `main` and are
  each independently re-readable at their cited line**, re-confirmed by
  this pass rather than trusted from the workflow-review's own write-up:
  tokened-election delete no longer 500s after telling leadership it
  succeeded (W50-1); an anonymous election's audit trail no longer names
  the voter on new `vote_cast` rows (`_audit_voter`,
  `election_service.py:534`, 3 call sites, W50-2); the in-app and token
  voting doors share one dedup key so a non-anonymous member cannot vote
  twice across channels (W50-3); an in-app vote naming a ballot item id as
  `position` is resolved to its effective position before the attendance
  check runs, closing the bypass (W50-4/W50-5); and a voided vote's unique
  dedup hash is cleared on soft-delete (`election_service.py:2222`) so the
  member it was voided for can vote again instead of both routes dying on
  `IntegrityError 1062` (W50-6).

### Findings

### ELEC-12 — LOW/MED — `SavedBallotTemplate` list/create still unbounded — 🚩 OPEN (re-verified, pass 7)

Unchanged. `list_saved_ballot_templates` (`elections.py:415-424`) has no
`limit`/`offset` — every template an org has ever saved returns in one
response. Re-read at its current citation (shifted from pass 6's
`391-401` by the intervening diff); logic identical.

### ELEC-14 — P2 — `verify_vote_receipt`'s credential is a GET query parameter, not body/fragment — 🚩 FLAGGED (re-verified, pass 7)

Unchanged. `receipt: str` (`elections.py:4147`) is still a query parameter,
landing in server/proxy logs and browser history — the same class of leak
the token endpoints deliberately avoid via POST body (R-D3). Current
citation: `elections.py:4145-4149`.

### ELEC-16 — P2 — `list_manual_ballot_batches` is unbounded — 🚩 FLAGGED (re-verified, pass 7)

Unchanged. `election_service.py:4411-4440` (shifted from pass 6's
`3958-3974`) still has no cap on batches returned per election — bounded
in practice by one department's own paper-ballot recording volume, not by
the query.

### ELEC-28 — LOW/MED — The in-app ballot cannot render a ballot-item or multi-seat contest — 🚩 OPEN (re-verified, pass 7; converges with W50-10/W50-11)

Re-read `ElectionBallot.tsx:60-78` (`getPositions()`/
`getCandidatesForPosition()`): still iterates only `election.positions`,
with `ballot_items` and `max_votes_per_position` ignored exactly as pass 3
found. The 2026-09-30 workflow review independently rediscovered the same
gap from the voter-experience angle and filed it as **W50-10** (HIGH,
"the in-app Cast Vote tab is not the ballot") and **W50-11** (HIGH, "a (2
seats) board race declares one winner"), both still FLAGGED pending an
owner decision on whether to rewrite the tab against the token page's
model or hide it when the election has ballot items/a seat cap > 1. This
pass treats ELEC-28 and W50-10/W50-11 as **one gap, not three** — the
root cause and fix are identical — and defers to the owner decision W50-10
already asked for rather than re-asking it under a different id.

**Correction (pass 9, 2026-10-14): this entry was already stale when pass 7
wrote it.** The owner decided this exact item on 2026-10-05 — see this
file's **Owner decisions applied (2026-10-05)** section, "ELEC-28 / W50-10
... fixed: one ballot model" — the same date pass 7 ran. `ElectionBallot.tsx`
had already been rewritten around `GET /elections/{id}/ballot` and the
shared `BallotItemCard`, with no `getPositions()`/`getCandidatesForPosition()`
left to find; pass 7 and pass 8 each re-cited the pre-fix function names
without re-reading the file. See **Pass 9** for the resolution.

### ELEC-40 — P1 — Pre-ELEC-34 vote dedup collision-avoidance edge case — 🚩 FLAGGED (re-verified, pass 7)

Unchanged. `_dedup_position_key`/`_dedup_scoped_item_aliases`
(`election_service.py:146-240`) are untouched by this window's diff — grepped
every call site (12, same shape as pass 6) and confirmed none is inside the
2,237 changed lines. The known limitation (an owner decision between
reverting the ELEC-38 narrowing or a backfill migration) stands exactly as
pass 3 described it.

### ELEC-43 — HIGH — A proxy ballot on an anonymous election is attributable — ✅ RESOLVED by owner decision (2026-10-08; cross-ref: W50-2/S01, `KNOWN_LIMITATIONS.md`)

**What:** S01 (W50-2's fix) stops `vote_cast`/`vote_cast_token` audit rows
from naming the voter on an anonymous election. It does not touch
`cast_proxy_vote`: `proxy_vote_cast` and `proxy_vote_double_attempt`
(`election_service.py:6625-6659`) unconditionally write
`delegating_user_id` and `proxy_user_id` into `event_data` in clear,
**regardless of `election.anonymous_voting`**, and the `Vote` row itself
stores the same two ids in clear (confirmed by reading the full call —
there is no `_audit_voter`/anonymity branch anywhere in this function,
unlike `cast_vote`'s three call sites).
**Where:** `election_service.py:6625-6660` (`cast_proxy_vote`'s audit
calls); the `Vote` row's `proxy_delegating_user_id`/`proxy_voter_id`
columns persist the same linkage independently of the audit log.
**Failure scenario:** a department runs an anonymous officer election; a
member authorizes a proxy; the proxy casts the vote. Anyone who can read
the audit log or the `votes` table (an admin, a DB backup, a future
export) learns exactly how the delegating member's proxy voted — the one
voter class this feature's anonymity guarantee does not cover, while the
certified PDF and every UI surface still assert "voter de-anonymization
impossible."
**Impact:** every proxy vote on every anonymous election, past and
future — not a historical-rows residual like the ELEC-6/W50-2 audit-row
cases, but the proxy path's **current, ongoing** behavior.
**Disposition:** already discovered and fully written up by the 2026-09-30
workflow review (its own S01/W50-2 investigation) and mirrored into
`docs/KNOWN_LIMITATIONS.md` ("A proxy ballot on an anonymous election is
attributable", HIGH) the same day. Re-verified independently against
current code this pass, not trusted from that doc — confirmed unchanged.
Folded into this ledger under its own ELEC id because it falls squarely
inside this checklist's §5 (data exposure) and no prior ELEC-06 pass had
numbered it. **Not fixed here**: closing it needs either (a) documenting
that a proxy ballot is attributable and disclosing that to the delegating
member when the authorization is created, or (b) storing the linkage as a
salted hash that dies with the anonymity salt at close plus a migration
over existing rows and a `_sign_vote` change — both are product/schema
decisions, not a same-pass mechanical fix, and no proxy-vote UI exists
today to drive urgency. Same disposition as `KNOWN_LIMITATIONS.md`.
**Resolution (2026-10-08):** the owner chose (a) and made the
disclosure an acknowledgement. An authorization on an anonymous election
requires `anonymity_acknowledged` (refused otherwise) and is stamped
`anonymity_acknowledged_at`; the delegating member is emailed the warning;
an unstamped authorization on an anonymous election is refused at the
ballot (`_proxy_anonymity_error(election, auth)`), so nothing created before
the rule casts an attributable ballot unannounced; and the certified PDF's
anonymity sentence names the proxy votes as the exception. The audit rows
and vote columns keep the linkage in clear, by that decision. Guard:
`tests/test_w50_proxy_anonymity_ack.py`.

### ELEC-44 — LOW — The election body and the public ballot lookup over-expose recipient list, live vote counts, and candidate identity ids — ✅ RESOLVED by owner decision (2026-10-08; cross-ref: W50-70, `KNOWN_LIMITATIONS.md`)

**Resolution:** while OPEN, the election body withholds recipients, the voter list and (unless results are public) live counts from non-managers, the list withholds `total_votes` likewise, and the ballot lookup / in-app ballot serve `BallotCandidateResponse` without member ids. Guard: `tests/test_w50_member_live_detail.py`.

**What:** `ElectionResponse` (`schemas/election.py:540-592`) includes
`email_recipients: Optional[List[UUID]]` and (via `_build_election_response`)
live vote counts, served to any `elections.view` holder via
`GET /elections/{id}` — while `GET /elections/{id}/results` requires the
same `elections.view` permission but `get_election_results` (the service
method it calls) additionally gates on the election being closed or
`results_visible_immediately`, returning `None` → 403 otherwise
(`elections.py:2564-2583`). Separately, `BallotLookupResponse.candidates` (the public,
token-only `/ballot/lookup` response, `elections.py:526-530` /
`:659-663`) is built from the full `CandidateResponse` schema, which
carries `user_id` and `nominated_by` (`schemas/election.py:883,890`) —
read directly: `lookup_ballot_by_token` validates every candidate through
`CandidateResponse.model_validate(c)` with no field-stripping, so an
anonymous token holder receives every accepted candidate's internal
member-account id and nominator id, not just their name and statement.
**Where:** `schemas/election.py:540-592` (`ElectionResponse`),
`schemas/election.py:878-891` (`CandidateResponse`),
`elections.py:659-663` (the public lookup's use of it).
**Impact:** an `elections.view`-only member (not a manager) can read who
was sent a ballot and the running tally while voting is open, which
`/results` itself withholds from the same caller; and any anonymous
token holder — including one who never authenticated — learns internal
account ids for every candidate, which the public ballot page has no
legitimate use for voting.
**Disposition:** discovered and written up by the 2026-09-30 workflow
review (W50-70) and mirrored into `KNOWN_LIMITATIONS.md` the same day,
explicitly as an owner decision ("probably intended for attendees and
recipients; decide whether counts and ids are withheld while the election
is open"). Re-verified independently this pass against the current schema
and the live `lookup_ballot_by_token` body — unchanged. Folded into this
ledger as a §5 finding for the same reason as ELEC-43. **Not fixed here**:
`CandidateResponse` is shared between this public path and every
authenticated candidate-management endpoint, so narrowing it needs a
separate public-facing projection (mirroring the `BallotElectionResponse`
R-2 precedent already applied to the election object itself, just not yet
to the nested candidate list) — a deliberate schema split, not a one-line
change, and the severity (LOW; internal UUIDs, not names or PII beyond
what the ballot already shows) does not by itself justify guessing at the
right contract without the owner's input on what a recipient or attendee
is meant to see.

### ELEC-45 — MED — A sanctioned void certifies the election's vote chain CHAIN_BROKEN, while voiding the chain's tail evades detection entirely — ✅ RESOLVED (2026-10-08, owner decision; cross-ref: W50-31, `KNOWN_LIMITATIONS.md`)

**Resolution:** the owner chose "walk voids and report them". `verify_vote_integrity` no longer filters `deleted_at` before the walk: voided rows are signature-checked and chained like every other row, and returned as `voided_votes` / `voids` (officer, reason, time). A sanctioned void reads PASS with the void named on the Forensics panel and certified PDF, a tail void is reported rather than silent, and a voided row altered after the fact still fails. Guard: `tests/test_w50_integrity_with_voids.py`.

**What:** `verify_vote_integrity` (`election_service.py:2045-2120`; pass 6 cited
`1879-1945`, shifted by the intervening diff — re-read in full this pass) drops soft-deleted rows **before**
walking the hash chain. Read in full: this makes the forensics/tamper
detection this feature's audit chain exists to provide give **both** a
false positive and a false negative from the same mechanism — an
officer's own sanctioned void (with a recorded reason, on a vote that is
not the chain's most recent link) breaks the walk and reports
"CHAIN_BROKEN" on the certified PDF under "We certify that the results
above are true and correct," while an actual attacker who deletes the
**last** vote in the chain (the one case deletion cannot break a
hash-chain's walk over what remains) gets a clean PASS.
**Where:** `election_service.py:2045-2120` (`verify_vote_integrity`,
specifically the `Vote.deleted_at.is_(None)` filter at `:2078` applied
before the chain-reconstruction walk at `:2101-2120`); the
certified-results builder and `ElectionDetailPage.tsx`'s integrity banner
both surface the same (possibly false in either direction) verdict.
**Impact:** this is the feature's own tamper-evidence control giving the
department exactly the wrong signal in both directions — alarming them
over a legitimate, audited action, and staying silent over the one
deletion pattern an attacker would actually choose if they wanted to
avoid detection.
**Disposition:** discovered by the 2026-09-30 workflow review (W50-31),
mirrored into `KNOWN_LIMITATIONS.md` the same day as an owner decision
(the chain design must decide how a void is represented — "walk voided
rows too and report 'PASS — N votes voided by `<officer>`: `<reason>`'" is
the write-up's own suggested shape). Re-verified independently this pass
against the current function body — unchanged, still drops deleted rows
before the walk. Folded into this ledger under §4/§5 (the audit chain is
this feature's injection/tamper-evidence control) rather than left solely
in a workflow-review file, since a future ELEC-06 pass needs to know this
control's current reliability without cross-referencing elsewhere.
**Not fixed here**: changing what "PASS" means for a chain with voided
rows is exactly the kind of security-control semantics change CLAUDE.md's
"flag, don't guess" guidance covers, and a same-pass mechanical change
risks quietly weakening the chain's guarantee in the other direction (a
walk that too easily accepts voided rows as explained could also let a
real tamper event hide behind a bogus void reason).

### ELEC-46 — MED — A manager can accept a nomination on the nominee's behalf; the slate is not frozen at Close Nominations — ✅ RESOLVED by owner decision (2026-10-08; cross-ref: W50-38, `KNOWN_LIMITATIONS.md`)

**Resolution:** on-behalf acceptance is allowed before nominations close and is now labelled (`candidates.accepted_on_behalf_by` / `_at`), audited (`nomination_accepted_on_behalf`) and notified to the nominee; Close Nominations stamps `elections.nominations_closed_at`, after which `respond_to_nomination` and the manager toggle both refuse until nominations reopen. Guard: `tests/test_w50_manager_accept_frozen_slate.py`.

**What:** `PATCH /{election_id}/candidates/{candidate_id}` accepts an
`accepted: true` update from any `elections.manage` holder with **no
nominee-identity check** — read directly: the endpoint's permission gate
and the service call it drives contain no comparison against the
nominee's own user id, unlike `accept_nomination`/`decline_nomination`
(`elections.py:1626-1696`), which do enforce "only the nominee can
respond." A manager can therefore accept (or, after Close Nominations,
decline) on a nominee's behalf with no notice to them. Separately, the
nominee loses the Nominations tab once nominations close, but the
accept/decline API routes do not themselves refuse a call after that
point (the positions-removal guard S17 added, `7aa3405`, closes a
different, narrower gap — an item-keyed candidate wrongly counted as
orphaned — and does not address this one).
**Where:** `CandidateManagement.tsx:203,553-560` (the manager-facing
Accept toggle); `PATCH /{election_id}/candidates/{candidate_id}`
(`elections.py:2219-2328` — read in full this pass: no comparison of
`current_user.id` against the candidate's `user_id`/`nominated_by`
anywhere in the handler, only the org-scope check at `:2239` and the
post-vote identity freeze at `:2288-2300`); `ElectionDetailPage.tsx` (tab
gating, UI-only).
**Impact:** this is a separation-of-duties gap the checklist's §2 calls
out directly ("the approver cannot be the requester") — here inverted (the
manager can act _as_ the nominee without being one), but the same
principle: an acceptance a candidate did not make is indistinguishable, in
the data, from one they did.
**Disposition:** discovered by the 2026-09-30 workflow review (W50-38),
mirrored into `KNOWN_LIMITATIONS.md` the same day as an explicit owner
decision ("decide whether managers may accept on a nominee's behalf — then
label it so and notify them — and whether the slate freezes at Close
Nominations"). Re-verified independently this pass against the current
endpoint body — unchanged. Folded into this ledger under §2 for the same
reason as ELEC-43/44/45. **Not fixed here**: both candidate remedies
(requiring the nominee's own id, or labeling and notifying an on-behalf
acceptance) are product decisions about what a manager may do, not a
mechanical permission-string fix, and the slate-freeze question changes
observable behavior for every election already using this flow.

## Schema & migration notes

4 election-table migrations landed since the diff baseline, all read in
full this pass:

- `20260930_0840_6394fbf42581` — nulls `votes.vote_dedup_hash` on rows
  already soft-deleted (W50-6 backfill). Idempotent (`WHERE deleted_at IS
NOT NULL AND vote_dedup_hash IS NOT NULL`), guarded on both the table
  and both columns existing (Pitfall #26), and explicitly, correctly
  irreversible — the hash cannot be recomputed from a destroyed
  anonymity salt, and the only effect of trying would be to re-lock a
  voided voter out.
- `20260930_0853_ac06a2998013` — adds `elections.closed_at`
  (nullable) and `elections.closed_by` (nullable `String(36)`,
  `ForeignKey("users.id", ondelete="SET NULL")`) — **Pitfall #2
  compliant** (nullable=True alongside SET NULL), guarded on table/column/
  FK existence, correct downgrade ordering (FK → columns).
- `20260930_1153_c8266855a348` — reworded stored email templates only (no
  column/table change); not re-read line-by-line this pass since it
  touches no schema or query, consistent with "Match the Verification to
  the Change."
- `20260930_1230_c4e8a1f7d2b6` — adds `elections.email_skipped_details`
  (nullable JSON). Write path (`_merge_skipped_details`,
  `election_service.py:8087-8111`) builds and returns a **new** list
  object on every call rather than mutating the prior value in place and
  reassigning it — not the Pitfall #12 shallow-copy shape, so no
  `deepcopy`/`flag_modified` is needed here.

`validate_migrations.py --strict`: 512 revisions, single head
`34d3d56d1479`, no duplicate ids (see Completion gate).

## Guard tests added

None by this pass — W50's own six backend test files
(`test_w50_s*.py`, `test_w50_delete_tokened_election.py`,
`test_w50_voided_voter_revotes.py`, and others cited inline above) already
cover every fix this pass re-verified, each confirmed failing against the
pre-fix code before being counted (per that review's own write-up); adding
a duplicate guard here would test the same invariant twice rather than
close a new one. ELEC-43/44/45/46 are flagged, not fixed, so there is
nothing yet to regression-guard.

## Completion gate (pass 8)

| Check                                                                                  | Result                                                                                   |
| -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `flake8 app/ tests/ alembic/` (backend)                                                | ✅ 0 violations                                                                          |
| `black --check app/ tests/ alembic/`                                                   | ✅ 2197 files unchanged                                                                  |
| `isort --check-only app/ tests/ alembic/`                                              | ✅ clean                                                                                 |
| `python3 scripts/validate_migrations.py --strict`                                      | ✅ 575 revisions, single head `7a849409c1d0`                                             |
| `python3 scripts/check_route_permissions.py --strict` (repo root)                      | ✅ 266 routes, 0 errors, 0 warnings                                                      |
| `python3 scripts/generate_schema_docs.py`                                              | ✅ regenerated (303 tables, 5006 columns — +1 column vs. committed; included in this PR) |
| `python3 scripts/check_docs_links.py`                                                  | ✅ 425 files, 0 broken links                                                             |
| `pytest tests/ -q -k "election or ballot or quorum or candidate or proxy"` (unit-only) | ✅ 565 passed, 1 skipped (pre-existing, `py_vapid`), 0 failed                            |
| `cd frontend && npm run typecheck`                                                     | ✅ 0 errors                                                                              |
| `cd frontend && npm run lint`                                                          | ✅ 0 errors, 0 warnings                                                                  |
| `npx vitest run` — elections-module + ballot/receipt frontend tests (33 files)         | ✅ 33/33 files, 172/172 tests passed                                                     |
| `npx vitest run src/modules/testing/testingRegistry.test.ts`                           | ✅ 12 passed                                                                             |
| `npx playwright test src/e2e/mobile-route-integrity.spec.ts --project=chromium`        | ✅ 1 passed                                                                              |

No application code was changed this pass — every item above is either an
independent re-verification of an already-landed fix or a standing
FLAGGED/OPEN item re-confirmed unchanged, so this gate confirms the large
W50-driven diff left the codebase clean, independently re-run rather than
trusted from the commits' own write-ups. `generate_schema_docs.py`'s
one-line diff (column count only) is carried in this PR per Pitfall #30c
since it was stale on `main` before this pass touched it.

---

## Completion gate (pass 7)

| Check                                                                                | Result                                                       |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------------ |
| `flake8 app/ tests/ alembic/`                                                        | ✅ 0 violations                                              |
| `black --check app/ tests/ alembic/`                                                 | ✅ 1874 files unchanged                                      |
| `isort --check-only app/ tests/ alembic/` (confirmed installed, not a no-op)         | ✅ clean                                                     |
| `python3 scripts/validate_migrations.py --strict`                                    | ✅ 512 revisions, single head `34d3d56d1479`                 |
| `python3 scripts/check_route_permissions.py --strict` (repo root)                    | ✅ 244 routes, 0 errors, 0 warnings                          |
| `pytest tests/ -q -k "election or ballot or quorum or candidate or mcp"` (unit-only) | ✅ 622 passed, 1 skipped (pre-existing `py_vapid`), 0 failed |
| same, full run (DB available this session)                                           | ✅ 1092 passed, 1 skipped, 0 failed                          |
| `cd frontend && npm run typecheck`                                                   | ✅ 0 errors (aliased 7.0.2 compiler, via `tsc-native.mjs`)   |
| `cd frontend && npm run lint`                                                        | ✅ 0 errors, 0 warnings (exit 0)                             |
| `npx vitest run` — elections-module frontend tests (38 files)                        | ✅ 38/38 files, 148/148 tests passed                         |

No application code was changed this pass — every finding above is either a
re-verification of an already-landed fix or a FLAGGED cross-reference
needing an owner decision, so the gate is a confirmation that the large W50
diff left the codebase in the clean state its own completion gate already
reported, independently re-run rather than trusted.

---

## Pass 6 (2026-09-15)

**Scoping.** Step 0: `git fetch origin main` clean. The working directory was
found checked out on `claude/security-review-fin-pass6-a3f9c2` (a leftover
branch from the prior iteration, Feature 05) with a clean tree — left
untouched per this run's own instructions, and a fresh branch
(`claude/security-review-elec-pass6-<shortid>`) was cut directly from
`origin/main`. `PROGRESS.md`'s Open PR row (at `origin/main`'s tip) named PR
[#2599](https://github.com/thegspiro/the-logbook/pull/2599) (Feature 05,
Finance & approvals, pass 6) as open; `pull_request_read` confirmed it
`merged: true`, `merged_at: 2026-09-15T20:20:14Z`, and its merge commit
(`7754eccd7`) is the tip of `origin/main`, with rotation row 05 already ✅ as
part of that same merge — so this iteration recorded the merge and proceeded
to Feature 06 rather than tending a still-open PR. `search_pull_requests`
(open) returned only #2590, #2594 and #2595 — a form-stage fix, an npm
override checker, and an attendance-gate fix, none touching
elections/ballots/voting — and `list_branches` showed no branch referencing
Feature 06/elections/ballots. Proceeded to Feature 06.

**Baseline and delta.** Pass 5 merged as `f45f691f3` (PR #2546). `git diff
--stat f45f691f3..origin/main` across the full established domain —
`endpoints/elections.py`, `services/election_service.py`,
`services/quorum_service.py`, `models/election.py`, `schemas/election.py`,
`utils/election_ballot_pdf.py`, and the entire frontend elections surface
(`components/BallotBuilder.tsx`, `ElectionBallot.tsx`, `ElectionResults.tsx`,
`components/election-detail/*`, `pages/BallotVotingPage.tsx`,
`pages/ElectionDetailPage.tsx`, `pages/ElectionsPage.tsx`,
`pages/ElectionsSettingsPage.tsx`, `services/electionService.ts`,
`types/election.ts`, `utils/electionHelpers.ts`) — found **exactly one file
touched, by exactly one line-level change**: `elections.py`'s
`list_candidates` gate widened from `require_permission("elections.view")`
to `require_permission("elections.view", "elections.manage")`
(`elections.py:1943-1945`). No migration since pass 5 touches an election
table (grepped migration bodies, not filenames, for
`elections`/`candidates`/`votes`/`voting_tokens`/`manual_ballot_batches`
across every revision added since `f45f691f3` — none found, matching
`validate_migrations.py`'s count of 444 revisions, unchanged from pass 5).

**The one change, independently verified rather than accepted on the commit
message.** The responsible commit, `4b7bd1adb` ("admit the manage grant to
seven reads that branch on it"), is the same cross-module OR-gate sweep
FIN-05 pass 6 and PUB-03 pass 6 each independently re-verified from their own
side that pass — it widened seven reads across three features from a single
required permission to an OR-gate admitting a `.manage` grant too, matching
each route's own body already branching on `.manage` to widen scope past the
default. Read `list_candidates` in full: its body computes `include_pending
= election.status == ElectionStatus.NOMINATIONS or
user_has_permission(current_user, "elections.manage")` — a plain
`elections.view` holder still sees only accepted candidates outside the
nomination window, and only a caller who actually holds `elections.manage`
sees pending/unaccepted candidates, regardless of which permission in the
OR-gate got them past `Depends`. The commit widened who can **reach** the
handler (a caller holding `elections.manage` without `elections.view`, an
unusual grant shape but not one the permission model forbids), not what the
body does once inside — no new exposure. `check_route_permissions.py
--strict` and a fresh `grep -c "require_permission("` / `grep -c
"Depends(get_current_user)"` / `grep -c "^@router\."` sweep confirm the
route/gate counts are unchanged from pass 5 (56 permission-gated, 5
authenticated-only, 4 public token routes, 65 total; the raw
`Depends(require_permission` substring count dropped from 56 to 55 only
because `black` line-wrapped this one call across two lines — a formatting
artifact, not a dropped gate).

**First review of `app/mcp/tools/elections.py` under this feature**, per the
precedent this rotation's own pass-5 lap established for other features
(`docs/security-review/DOC-10-documents-legal.md` pass 5,
`AP-13-apparatus-nfc.md` pass 12, `FAC-12-facilities.md` pass 5 — each added
a first read of that feature's own `app/mcp/*` surface). This 184-line file
(present since `663333b46`, well before pass 5, but never mentioned in this
findings doc across five prior passes) registers three read-only tools for
Claude's MCP integration: `list_elections`, `get_election_description`,
`get_election_results`. Read fresh, end to end:

- **Org-scoping.** `list_elections` filters `Election.organization_id ==
principal.organization_id` directly (`elections.py:101`, the MCP module's
  own file, not the REST endpoint of the same name);
  `get_election_description` / `get_election_results` both resolve through
  the shared `_election()` helper (`mcp/tools/elections.py:74-82`), which
  calls `ElectionService(db).get_election(id, org_uuid(principal))` — the
  same already-org-scoped service method every REST endpoint in this feature
  uses — and raises before either tool touches the row. No 14a/14b/14c gap.
- **No ballot-secrecy exposure.** `get_election_results` returns
  `ElectionResults` (`schemas/election.py:922`): aggregate tallies
  (`total_votes`, `turnout`, `results_by_position`, `overall_results`) with
  no per-voter, per-IP, or forensics field — the schema carries nothing
  `get_election_forensics` guards. It is additionally **more conservative
  than the REST endpoint it wraps**: the tool refuses unless
  `election.status == ElectionStatus.CLOSED` (`mcp/tools/elections.py:171`),
  where the REST path also honors a per-election
  `results_visible_immediately` flag to show a live tally while voting is
  still open — the MCP tool's own comment
  (`mcp/tools/elections.py:168-170`) states this is deliberate ("a live
  tally is never shown here, whatever that flag says"), and the code matches
  the comment.
- **No roster/eligibility leak.** `list_elections`' per-item projection
  (id, title, description, type, status, positions, dates, voting method,
  anonymity flag, quorum) carries none of what R-2 (module-audit, 2026-07)
  found and fixed on the public ballot path — no `attendees`,
  `eligible_voters`, `email_recipients`, or `created_by`.
- **Bounded, scrubbed free text.** `_clip`/`_chunk`/`_positions`
  (`mcp/tools/elections.py:22-71`) cap description and position-name length
  and run every string through `scrub_text` (the same PII-redaction pass
  every other MCP tool module uses) before it leaves the tool — consistent
  with `ELECTION_TEXT_CHARS`/`POSITION_NAME_CHARS` being feature-specific
  instances of the same paging pattern `mcp/tools/documents.py` and
  `mcp/tools/apparatus.py` already use.
- **Framework-level gating and audit unchanged.** `logbook_tool`
  (`app/mcp/registry.py`) — shared by every module, not elections-specific —
  refuses a call when the org has the `elections` module disabled
  (`principal.module_enabled`) before the handler runs, and records an audit
  row (`mcp.tool_call`) for every outcome including a refusal; none of the
  three elections tools declare a `gate=` (no write/finance/medical_screening
  switch applies to read-only election data), which is correct — these are
  read-only informational tools, not the write-capable "create a draft"
  shape `gate="write"` exists for.

**Gap found, not a leak: no test previously exercised elections'
org-scoping.** Unlike `list_members` (`test_list_members_is_org_scoped`,
`tests/test_mcp_tools.py:159`) and every other listing tool with an explicit
cross-org test in this file, nothing asserted that a second organization's
principal gets an empty result from `list_elections` or a "not found" from
the two by-id tools. The code is correct (see above), but the invariant was
unverified — exactly the shape CLAUDE.md Pitfall #14 warns a later refactor
can silently reopen. Added
`TestThirtyFirstRoundFindings::test_elections_are_org_scoped`
(`tests/test_mcp_tools.py`), asserting a foreign-org principal sees
`total == 0` from `list_elections` and a `ToolError` ("not found") from both
`get_election_description` and `get_election_results` against the same-org
election's real id, with a final assertion that the owning org's principal
still sees it (proving the empty result above is org-scoping, not a broken
fixture). Confirmed the test fails against deliberately broken code (removed
`list_elections`' `organization_id` filter, re-ran, got the expected
`AssertionError`; restored and re-ran clean) before counting it as a real
guard.

**Re-checked client-supplied FK validation across every create/update path
that accepts one**, specifically hunting for the AP-17/AP-18 shape (a
sibling method in the same group validates a foreign-org id, one method in
the group does not): `create_nomination`'s `nominee_user_id`
(`election_service.py:3385`, explicitly commented `# XC-1`, resolves the
nominee through an org-scoped `User` lookup and rejects an inactive/foreign
member); `add_proxy_authorization`'s `delegating_user_id`/`proxy_user_id`/
`authorized_by` (`election_service.py:5735`, all three resolved via
org-scoped `User` lookups before the authorization record is built);
`merge_write_in_candidates`'s `source_candidate_ids`/`target_candidate_id`
(`election_service.py:4267`, both resolved as a single `IN` query scoped to
`Candidate.election_id == <the already org-scoped election>`, with a
`missing = wanted - set(by_id)` check that rejects any id outside that set);
`send_ballot_emails`'s `recipient_user_ids`
(`election_service.py:6169-6174`, filtered by `User.organization_id` in the
query itself, so a foreign id simply resolves to nothing rather than
sending a cross-org email). No gap found in any of the four.

**5 prior findings re-verified, no drift:** ELEC-12 (`SavedBallotTemplate`
list/create still unbounded, `elections.py:391-401`, byte-identical since
pass 4), ELEC-14 (`verify_vote_receipt`'s `receipt: str` GET query param,
`elections.py:3846-3849`), ELEC-16 (`list_manual_ballot_batches` unbounded,
`election_service.py:3958-3974`), ELEC-28 (public ballot UI still cannot
render a plain-position contest — confirmed zero diff on
`BallotVotingPage.tsx` since pass 4), ELEC-40 (pre-ELEC-34 vote
collision-avoidance gap, documented known limitation, no code path changed).
Each re-confirmed against the current file/line, not carried forward from
the write-up. `docs/KNOWN_LIMITATIONS.md`'s corresponding entries are
unchanged and still accurate.

**0 new defects found. 0 application-code changes this pass** — the one
in-scope commit only widened who can reach an already-correct branch, and
the MCP surface reviewed for the first time is already correctly scoped.
**1 regression test added** closing a previously-unverified (but, on
inspection, correctly-implemented) invariant.

### Verified good ✅ (this pass)

- Every by-id query in `elections.py` and `election_service.py` still
  org-scopes correctly — re-confirmed via the FK-validation sweep above and
  pass 5's own full independent re-read (unchanged, since the file is
  byte-identical apart from the one gate widening).
- `app/mcp/tools/elections.py` — first review under this feature (see above):
  org-scoped, read-only, ballot-secrecy-safe, no roster leak, bounded and
  scrubbed text, correctly deferring to the shared `logbook_tool`
  gating/audit framework.
- ELEC-41/ELEC-42 rate-limit wrappers — unchanged (`elections.py` diff is
  confined to `list_candidates`, nowhere near `_ballot_read_rate_limit`/
  `_ballot_vote_rate_limit`); not re-run in isolation this pass since the
  scoped test run below re-executes `test_election_ballot_rate_limit.py`
  unchanged.
- Zero `csv.writer` calls remain (Pitfall #15 n/a — PDF exports only, matching
  every prior pass).

## Completion gate (pass 6)

| Check                                                                                 | Result                                                                                                                                        |
| ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `flake8 app/ tests/ alembic/`                                                         | ✅ 0 violations                                                                                                                               |
| `black --check app/ tests/ alembic/`                                                  | ✅ clean (1596 files) — one reformat applied to the new test before commit                                                                    |
| `isort --check-only app/ tests/ alembic/`                                             | ✅ clean                                                                                                                                      |
| `python3 scripts/validate_migrations.py --strict`                                     | ✅ 444 revisions, single head (`6ab7d903fae5`) — no migration this pass                                                                       |
| `python3 scripts/check_route_permissions.py --strict`                                 | ✅ 228 routes, 0 errors, 0 warnings                                                                                                           |
| `pytest tests/ -q -k "election or ballot or quorum or candidate or mcp"`              | ✅ 928 passed (927 + 1 new), 1 skipped (pre-existing `py_vapid`), 0 failed                                                                    |
| `pytest tests/ -m "not integration and not slow and not docker" -q` (full unit suite) | ✅ 10199 passed, 1 skipped, 0 failed — unchanged from FIN-05 pass 6, since the one new test is `integration`-marked and this job deselects it |
| `npm run typecheck` (frontend)                                                        | ✅ 0 errors — no frontend file changed this pass, run anyway per gate                                                                         |
| `npm run lint` (frontend)                                                             | ✅ 0 errors — no frontend file changed this pass, run anyway per gate                                                                         |

## Guard tests added

- `backend/tests/test_mcp_tools.py::TestThirtyFirstRoundFindings::test_elections_are_org_scoped`
  — asserts a foreign-org `McpPrincipal` gets an empty `list_elections`
  result and a "not found" `ToolError` from `get_election_description` /
  `get_election_results` against another org's election id, and that the
  owning org still sees it. Confirmed failing against deliberately
  reintroduced unscoped code before counting it as a guard.

---

## Pass 5 (2026-09-14)

**Scoping:** confirmed `PROGRESS.md`'s Open PR row read "None." (with the
pass-4 closure note preserved beneath it), and `list_pull_requests` (open,
all repos state) returned no branch or title referencing Feature 06 /
elections before starting. Branch `claude/security-review-feature06-pass5`
created fresh off `origin/main`.

**No file in scope changed since pass 4's merge commit
(`de8db76d3`).** `git log de8db76d3..origin/main -- backend/app/api/v1/endpoints/elections.py`
returns nothing, and `git diff de8db76d3 origin/main --
backend/app/api/v1/endpoints/elections.py` is empty — the file is
byte-identical to what pass 4 last reviewed. `quorum_service.py` is
likewise unchanged. `election_service.py` picked up one commit
(`ac9990d0c`, "Close seven email-configuration gaps found in review") that
touches the ballot-email send path: `send_batch` gained a Cloudflare
REST-API branch alongside its existing SMTP path, and the ballot-email
builder now calls `build_batch_message` (returning a `BuiltMessage`
carrying both the MIME and the structured fields) instead of `build_message`
(MIME only), so a Cloudflare-configured organization's ballot emails no
longer silently fail. Read this commit in full: it is a mail-delivery
correctness fix with no security-relevant surface for this scope — it does
not touch org-scoping, token validation/expiry/single-use enforcement,
ballot secrecy, vote counting, eligibility, or audit logging, and the vote
token itself is embedded in the ballot URL by
`send_ballot_emails`/`remind_non_voters` exactly as before, upstream of
where this commit's change begins. No migration touched an election table
(re-confirmed by grepping migration bodies, not filenames, for
`elections`/`candidates`/`votes`/`voting_tokens`/`manual_ballot_batches`
across every revision added since pass 4).

**Because nothing in scope changed, this was a full independent re-read of
`elections.py` end to end (all 3,895 lines, every route), not a diff
review** — the same standard pass 4 applied when it found no diffable
commit range. Read fresh rather than trusted from the write-up above:

- **Every by-id query in the file org-scopes correctly.** Re-enumerated all
  15 `select(Election|Candidate|Vote|SavedBallotTemplate)` call sites by
  line and confirmed each either filters `organization_id` directly, or
  resolves through `ElectionService.get_election(id, organization_id)`
  first (candidate CRUD, manual-ballot listing, voter overrides, proxy
  authorizations, preview-ballot, send-test-ballot). No 14a/14b/14c gap
  found. `create_candidate` still runs `assert_in_org` on a client-supplied
  `user_id` before persisting it; `_validate_election_links` still runs on
  both `create_election` and `update_election` for a client-supplied
  `meeting_id`/`event_id`.
- **ELEC-41/ELEC-42 (rate-limit wrappers) — confirmed still fixed, byte for
  byte.** `_ballot_read_rate_limit`/`_ballot_vote_rate_limit`
  (`elections.py:124-147`) are `async def`, `await check_rate_limit(...)`,
  and each passes its own `scope` (`"ballot_read"`/`"ballot_vote"`). Ran
  `backend/tests/test_election_ballot_rate_limit.py` directly (see gate
  below) rather than only reading the source.
- **Every 500-path in the module routes through `safe_error_detail()`.**
  Re-grepped all 19 `HTTPException(status_code=500, ...)` sites — no bare
  `detail=str(e)` anywhere, matching pass 4.
- **Zero `csv.writer`/`csv.DictWriter` calls** — this module's three
  exports (`printable-ballot`, `certified-results`, `package-pdf`) are all
  `StreamingResponse(media_type="application/pdf")`, not CSV. Pitfall #15
  remains n/a, as every prior pass found.
- **JSON-column mutations use `copy.deepcopy()` throughout.** Checked every
  site that reads then reassigns a JSON column — election settings
  (org-level `settings.election_defaults`/`proxy_voting`/
  `election_features`), `election.attendees`,
  `election.voter_overrides` (single add/remove and both bulk paths) — all
  deep-copy before mutating and reassign the copy, never a shallow `dict()`.
- **Audit logging is present on every state-changing route this pass
  read**, including the two lifecycle actions most likely to be missed:
  election deletion (`election_deleted_critical` with `severity="critical"`
  for a non-draft election, including the leadership-notification count and
  reason) and settings updates. No route in the file was found writing
  state without a corresponding `log_audit_event()` call.
- **No locking logic lives in this file.** The lock-then-read pattern this
  module depends on for TOCTOU safety
  (`_lock_token_ballot_for_submission`'s `.with_for_update()` +
  `populate_existing=True`) is entirely inside `election_service.py`, which
  — per the diff check above — is unchanged in that function since pass 3's
  own rounds fixed it (ELEC-17/24/25). No new read-then-write shape was
  introduced in `elections.py` itself; the endpoints that touch vote counts
  (`delete_candidate`'s vote-count guard, `soft_delete_vote`) either read a
  `func.count()` for a pre-condition check with no consequent write raced
  against it, or delegate the mutation to the service layer's own locked
  path.

**5 prior findings re-verified, no drift, no re-report needed:** ELEC-12
(`SavedBallotTemplate` list/create still unbounded, `elections.py:405-418`),
ELEC-14 (`verify_vote_receipt`'s `receipt: str` GET query param,
`elections.py:3861-3864`), ELEC-16 (`list_manual_ballot_batches` unbounded —
confirmed in the service layer, unchanged), ELEC-28 (public ballot UI still
cannot render a plain-position contest — `BallotVotingPage.tsx` still never
references `election.positions`; no frontend file in this repo changed
since pass 4 touches that page), ELEC-40 (pre-ELEC-34 vote
collision-avoidance gap — documented known limitation, no code path
changed). Each was checked against the current file/line, not carried
forward from the write-up.

**0 new findings.** This is a clean pass: a byte-identical scope file, one
reviewed-and-cleared out-of-scope dependency commit, and a fresh full read
that surfaced nothing beyond what five prior passes (through 42 numbered
findings) already found and fixed or flagged.

**Completion gate (pass 5):**

| Check                                                    | Result                                                                    |
| -------------------------------------------------------- | ------------------------------------------------------------------------- |
| `flake8 app/ tests/ alembic/`                            | ✅ 0 violations                                                           |
| `black --check app/ tests/ alembic/`                     | ✅ clean (1592 files)                                                     |
| `isort --check-only app/ tests/ alembic/`                | ✅ clean                                                                  |
| `python3 scripts/validate_migrations.py --strict`        | ✅ 444 revisions, single head (`6ab7d903fae5`) — no migration this pass   |
| `pytest tests/ -q -k "election or ballot or quorum"`     | ✅ 584 passed, 1 skipped (pre-existing `py_vapid` optional dep), 0 failed |
| `pytest tests/test_election_ballot_rate_limit.py -v`     | ✅ 7 passed, unchanged from pass 4                                        |
| `pytest tests/ -q` (full backend suite)                  | ✅ 12556 passed, 21 skipped (pre-existing/environmental), 0 failed        |
| `npm run typecheck` (frontend, aliased-compiler wrapper) | ✅ 0 errors — no frontend file changed this pass, run anyway per gate     |
| `npm run lint` (frontend)                                | ✅ 0 errors, 0 warnings                                                   |

No code change this pass, so no new guard test was added — the existing
`test_election_ballot_rate_limit.py` (7 tests, pass 4) was re-run rather
than modified.

---

## Pass 4 (2026-09-08)

**Scoping:** confirmed `main` tip (`ccb8451`) against `origin/main` before
starting; no security-review PR was open (`PROGRESS.md`'s Open PR row read
"None"; a GitHub PR search for `security(elections` returned only closed/
merged PRs). Route/permission counts re-enumerated from scratch rather than
trusted from pass 3's write-up: `grep -c "Depends(require_permission" /
"Depends(get_current_user)" / "^@router\."` on
`backend/app/api/v1/endpoints/elections.py` returns **56 / 5 / 65** —
unchanged from pass 3 (56 `elections.manage`/`elections.view` gated, 5
authenticated-only, 4 public token routes). Confirmed 65 total including the
4 public routes via a direct count of `^@router\.` decorators.

**Code did change since pass 3, but only by pass 3's own last rounds landing:**
`election_service.py` grew from the 7,962 lines pass 3 recorded to 8,632
(+670), `elections.py` from 3,809 to 3,880 (+71), `quorum_service.py` from 139
to 159 (+20). This repo's history has been squash-rewritten again since pass
3 (a single merge commit, `b267ee1`, now carries the entire pre-existing tree
as its first appearance of these files in `git log`), so the growth could not
be attributed to a diffable commit range — instead it was verified by content:
every fix pass 3's rounds 7–10 made (`_dedup_scoped_item_aliases`,
`eligible_positions`/`eligible_item_ids` snapshot handling,
`attest_manual_ballot_batch`'s `attested_by == batch.recorded_by` guard, the
`populate_existing=True` re-selects) is present verbatim in the current file,
confirming the diff is pass 3's own already-reviewed work and not new,
unreviewed code. No election-table migration landed since (55 migrations
existed as of pass 3's own check and none touched an election table by
content; re-confirmed no new ones touch `elections`/`candidates`/`votes`/
`voting_tokens`/`manual_ballot_batches` by grepping migration bodies, not
filenames).

**Re-verified against current code, not re-derived:**

- **ELEC-2, ELEC-7 (org-scoping on `update_candidate`/`delete_candidate`/
  `create_candidate`) — still fixed.** Both mutation endpoints still resolve
  the election via `get_election(election_id, current_user.organization_id)`
  before touching the candidate; `create_candidate` still runs
  `assert_in_org(db, User, candidate.user_id, ..., allow_none=True)` before
  persisting the client-supplied `user_id` (XC-1).
- **`respond_to_nomination` (self-scoping, checklist §2) — confirmed.**
  `accept_nomination`/`decline_nomination` are gated only by
  `elections.view` (the baseline `member` grant) by design — "only the
  nominee can respond" is enforced in the service
  (`election_service.py:3540`, `if str(candidate.user_id) != str(user_id):
return False, "Only the nominee can respond to this nomination"`), not by
  permission scope. `create_nomination` independently org-scopes both the
  election and the nominee lookup.
- **ELEC-6/R-D2 (ballot secrecy — IP/UA purge at close) — still intact.**
  `close_election` (`election_service.py:4811-4825`) still destroys
  `voter_anonymity_salt` and bulk-clears `ip_address`/`user_agent` on that
  election's `Vote` rows for anonymous elections in the same transaction.
- **Token path fail-closed ordering — re-traced, unchanged and correct.**
  `get_ballot_by_token` (line 7479) checks token existence → expiry → used →
  frozen-roll membership → election status/window, in that order, before any
  candidate/eligibility work, and returns `(None, None, <reason>)` — never a
  partial success — on every branch.
  `_lock_token_ballot_for_submission` (line 7557) re-checks all of the same
  mutable state under `.with_for_update()` +
  `.execution_options(populate_existing=True)` immediately before either
  vote-casting method does any writing, closing the TOCTOU window between
  the optimistic read in `get_ballot_by_token` and the actual write.
- **PDF exports (`printable-ballot`, `certified-results`,
  `pre-meeting-package`) — checked for the first time by name in this file.**
  All three are `elections.manage`-gated, resolve the election through
  `get_election(id, organization_id)` (org-scoped), and build their
  `Content-Disposition` filename via
  `re.sub(r"[^A-Za-z0-9_-]+", "_", election.title)[:60]` — no raw
  attacker-influenced title reaches the header. Pitfall #15 (`SafeCsvWriter`)
  remains n/a: these are PDF (`StreamingResponse`,
  `media_type="application/pdf"`), not CSV; still zero `csv.writer` calls in
  the module.
- **ELEC-12, ELEC-14, ELEC-16, ELEC-28, ELEC-40 — re-verified, all still
  accurately flagged/open, no drift.** Read each finding's exact code again
  rather than trusting the prior write-up:
  - ELEC-12 (`SavedBallotTemplate` list/create unbounded) —
    `elections.py:391-401` still has no `limit`/`offset`.
  - ELEC-14 (`verify_vote_receipt`'s `receipt: str` GET query param) —
    `elections.py:3846-3849`, signature unchanged.
  - ELEC-16 (`list_manual_ballot_batches` unbounded) —
    `election_service.py:3958-3974`, still no pagination.
  - ELEC-28 (public ballot UI cannot render a plain-position contest) —
    `frontend/src/pages/BallotVotingPage.tsx` only ever maps
    `election.ballot_items`; `election.positions` is not referenced anywhere
    in the file.
  - ELEC-40 (pre-ELEC-34 vote collision-avoidance gap) — the known
    limitation as documented; no code path changed.

### ELEC-41 — HIGH — Public ballot rate limiting was completely inert (silently unawaited coroutine) — ✅ FIXED

**What:** `_ballot_read_rate_limit` and `_ballot_vote_rate_limit` — the
`Depends()` used by all 4 public token-based ballot routes — were declared as
plain `def` functions that `return check_rate_limit(...)` **without
`await`**. `check_rate_limit` (`app/core/security_middleware.py:919`) is
itself `async def`. Calling an `async def` function without `await` only
constructs a coroutine object; none of its body — including the Redis/
in-memory limit check and the `HTTPException(429)` it raises when a limit is
exceeded — ever executes. FastAPI decides whether to `await` a dependency by
inspecting whether the **dependency callable itself** is a coroutine function
(`inspect.iscoroutinefunction`), not by inspecting what calling it returns —
so a sync `def` wrapper around an async call is invisible to that check.
FastAPI ran the sync wrapper (in a threadpool), received a coroutine object
back as the "result", discarded it, and let the request through. The only
observable trace was a "coroutine 'check_rate_limit' was never awaited"
`RuntimeWarning`, which nothing surfaces to an operator.

**Where:** `backend/app/api/v1/endpoints/elections.py:117-132` (pre-fix line
numbers).

**Failure scenario:** an attacker sends unlimited `POST
/api/v1/elections/ballot/lookup`, `POST /api/v1/elections/ballot/vote`,
`POST /api/v1/elections/ballot/vote/bulk`, or `GET
/api/v1/elections/{id}/verify-receipt` requests from one IP with no
throttling or lockout whatsoever — the two documented, verified-good
compensating controls for this module's only unauthenticated surface (module-
audit: "Public endpoints rate-limited: 10/min reads, 5/min votes, IP
lockouts (300s/600s)") did not exist in practice. This does not break token
secrecy (512-bit tokens are not brute-forceable regardless of rate), but it
removes the app's only defense against automated hammering of these routes —
scripted DB/CPU load from unthrottled ballot lookups, or scripted attempts
against `verify_vote_receipt`'s receipt-hash lookup, at unlimited
request-per-second volume from a single IP.

**Impact:** every deployment running this code had no working rate limit on
its 4 public voting endpoints, for as long as this code has existed —
verified present (and equally broken) as far back as this pass could trace it
by content; the wrappers were byte-identical in the diff-from-`a518957e5`
check pass 3 ran and reported no change in.

**Fix:** both wrappers are now `async def` and `await check_rate_limit(...)`,
matching every other rate-limit wrapper pattern in the codebase (e.g.
`app/api/public/finance_approvals.py`'s `_rate_limit`). Verified the fix by
hand: `inspect.iscoroutinefunction` now returns `True` for both, and a
FastAPI-shaped dependency-resolution simulation (mirroring
`fastapi.dependencies.utils.solve_dependencies`'s own
`is_coroutine_callable` check) confirms `check_rate_limit`'s body now
actually runs instead of being silently dropped.

**Guard test:** `backend/tests/test_election_ballot_rate_limit.py` — asserts
`inspect.iscoroutinefunction()` on both wrappers (the actual property FastAPI
inspects; this is the assertion that fails on the pre-fix code — verified by
stashing the fix and re-running), plus that `check_rate_limit` is reached
with the documented `max_requests`/`window_seconds`/`lockout_seconds` values
and that a raised `HTTPException(429)` propagates. The file's docstring
records — because it is not obvious and was hand-verified before writing the
test — that a test which merely does `await wrapper(...)` directly would
have passed on the broken code too, since manually awaiting the wrapper's
return value drives the coroutine regardless of whether the wrapper itself
was ever awaited by anything (which is exactly the distinction FastAPI's own
resolution makes and the bug depended on).

### ELEC-42 — MED — Ballot read and vote limiters shared one bucket (Codex review, PR #2400) — ✅ FIXED

**What:** ELEC-41's fix made both wrappers `await check_rate_limit(...)`, but
neither passed `scope`. `check_rate_limit`'s `scope` parameter defaults to
`"auth"`, and its own docstring is explicit about why that default is unsafe
to leave in place for more than one caller: "Without it, every ... limiter
shared a single ... bucket, so unrelated operations drained each other's
budget." That is exactly what happened here — `_ballot_read_rate_limit` (10
req/min) and `_ballot_vote_rate_limit` (5 req/min, the stricter cap) both
tracked against the same `auth:{ip}` counter.

**Failure scenario:** a voter looks up their ballot, previews it, and
re-checks their receipt a few times before submitting (5 read requests) —
ordinary behavior for the one ballot most voters cast once. Their next
request, the actual vote, lands on a bucket already at the 5-request cap
shared with those reads and is rejected with 429. Worse, when Redis is
unavailable the fallback in-memory limiter's lockout (300s for reads, 600s
for votes — whichever wrapper trips it first) blocks **both** request kinds
together, and the lockout is per-IP, so every voter behind the same NAT
(a firehouse's own network, a shared office) is locked out by one person's
ordinary read traffic.

**Where:** `backend/app/api/v1/endpoints/elections.py` (the same
`_ballot_read_rate_limit`/`_ballot_vote_rate_limit` wrappers ELEC-41 fixed).

**Fix:** each wrapper now passes its own stable `scope`
(`"ballot_read"` / `"ballot_vote"`), matching the convention used everywhere
else `check_rate_limit` is called with more than one caller in a module
(`app/api/v1/onboarding.py`, `app/core/security_middleware.py`'s own
login/register/password-reset/token-refresh/password-change scopes). No
change to the request-count/window/lockout values themselves — only the
bucket the counts are tracked under.

**Guard test:** extended `backend/tests/test_election_ballot_rate_limit.py`
with `test_ballot_read_and_vote_limiters_do_not_share_a_bucket` (asserts the
two wrappers' `scope` kwargs are both present and distinct) and added a
`scope` assertion to each existing `test_*_actually_invokes_the_limiter`
test. Confirmed all three fail against the pre-fix (no-`scope`) code —
`KeyError: 'scope'` on the two updated tests, and the new test — by stashing
the fix and re-running, then confirmed green after restoring it.

**Pass 4 summary: 2 fixed (ELEC-41 HIGH, ELEC-42 MED — the second caught by
Codex review on this pass's own PR), 0 flagged this pass — 5 prior findings
(ELEC-12, ELEC-14, ELEC-16, ELEC-28, ELEC-40) re-verified still accurately
open/flagged, no drift, no re-report needed.**

**Completion gate (pass 4, re-run after the ELEC-42 fix):**

| Check                                                       | Result                                                                                                                       |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `flake8 app/ tests/ alembic/`                               | ✅ 0 violations                                                                                                              |
| `black --check app/ tests/ alembic/`                        | ✅ clean (1536 files)                                                                                                        |
| `isort --check-only app/ tests/ alembic/` (9.0.1, CI's pin) | ✅ clean                                                                                                                     |
| `python3 scripts/validate_migrations.py --strict`           | ✅ 438 revisions, single head (`1603bd9c59e7`) — no migration this pass                                                      |
| `pytest tests/ -q -k "election or ballot or quorum"`        | ✅ 555 passed (554 + 1 new), 1 skipped (pre-existing `py_vapid` optional dep), 0 failed                                      |
| `pytest tests/test_election_ballot_rate_limit.py -v`        | ✅ 7 passed (6 + 1 new); confirmed 3 fail against the pre-ELEC-42-fix code by stashing the fix and re-running                |
| `pytest tests/ -q` (full backend suite)                     | ✅ 11850 passed, 21 skipped (pre-existing/environmental — py_vapid, Docker unavailable, opt-in API-contract suite), 0 failed |
| `npm run typecheck` (frontend, aliased-compiler wrapper)    | ✅ 0 errors — no frontend file changed this pass, run anyway per gate                                                        |
| `npm run lint` (frontend)                                   | ✅ 0 errors, 2 pre-existing warnings in an unrelated file (`CallTypeChips.tsx`), well under `--max-warnings 10`              |

New guard test: `backend/tests/test_election_ballot_rate_limit.py` (7 tests —
see ELEC-41 and ELEC-42 above for what each asserts and why the naive form
would not have caught either bug).

---

## Pass 3 (2026-09-02)

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

  **Re-enumerated again after all three Codex rounds' fixes (round 3 review,
  Codex finding: this count was already stale in the commit that introduced
  it — round 1's ELEC-15 and ELEC-18 fixes, and round 3's ELEC-25 fix, each
  added a site): 14 `.with_for_update()` sites, not 10.** Current
  `grep -n "with_for_update" election_service.py` output, by enclosing
  function:

  | Line   | Function                            | Locks                                                     |
  | ------ | ----------------------------------- | --------------------------------------------------------- |
  | `1148` | `cast_vote`                         | the caller's own prior vote (dedup)                       |
  | `1390` | `_get_user_votes`                   | conditional on `for_update=True` (used by `cast_vote`)    |
  | `3030` | `open_nominations`                  | `Election`                                                |
  | `3086` | `close_nominations`                 | `Election`                                                |
  | `3324` | `record_manual_ballots`             | `Election`                                                |
  | `3584` | `attest_manual_ballot_batch`        | `Election` — added by ELEC-15, reordered first by ELEC-24 |
  | `3602` | `attest_manual_ballot_batch`        | `ManualBallotBatch`                                       |
  | `3798` | `void_manual_ballot_batch`          | `Election` — **new, ELEC-25 (round 3)**                   |
  | `3819` | `void_manual_ballot_batch`          | `ManualBallotBatch` — added by ELEC-18                    |
  | `3833` | `void_manual_ballot_batch`          | `Vote` — added by ELEC-18                                 |
  | `4511` | `close_election`                    | `Election`                                                |
  | `4765` | `open_election`                     | `Election`                                                |
  | `7241` | `_lock_token_ballot_for_submission` | `Election` (`populate_existing=True` added by ELEC-17)    |
  | `7252` | `_lock_token_ballot_for_submission` | `VotingToken` (`populate_existing=True` added by ELEC-17) |

  (A 15th occurrence of the string, at line 7229, is a docstring reference,
  not a call site.) See ELEC-25 below for the fix that added the newest one.

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

### ELEC-25 — P2 — Voiding a manual-ballot batch had the same lock-order deadlock risk ELEC-24 fixed for attestation — ✅ FIXED

**What:** `void_manual_ballot_batch` (ELEC-18, round 1) locks
`ManualBallotBatch` first, then resolves `Vote` through a
`.join(Election).where(Election.organization_id == ...)` `FOR UPDATE`
select — which, on a join, locks the matching `Election` row too, but only
_after_ the batch lock. That is the identical child-then-parent order
ELEC-24 fixed for `attest_manual_ballot_batch`: `delete_election` locks the
`elections` row via its `DELETE` statement, and MySQL's `ON DELETE CASCADE`
on `manual_ballot_batches.election_id` then locks each batch row as it
cascades — parent-then-child. A concurrent void and delete on the same
election can each hold one row and block on the other (void holds the
batch, waits on the election via the join; delete holds the election, waits
on the batch via the cascade) — the same InnoDB deadlock shape as ELEC-24,
on a path ELEC-24's fix did not touch. Neither endpoint retries on a
deadlock error.

**Where:** `election_service.py:3793-3812` pre-fix numbering
(`void_manual_ballot_batch`: batch lock, then `Vote`+`Election` join lock).

**Does voiding need the same close-race protection ELEC-15/24 gave
attestation?** No — checked by reading `close_election` directly rather
than assuming. Attestation needed it because the batch's `pending →
confirmed` _transition_ is gated on the election being `OPEN`, and a stale
read of that status let a confirm slip past a concurrent close. Voiding has
no such gate: it never checks election status at all (matching
`soft_delete_vote`, the single-vote correction path, which is likewise
status-agnostic), and it can void a batch of any status, including an
already-`confirmed` one, at any time. More fundamentally, `close_election`
never snapshots or certifies vote/batch state — `get_election_results` and
`build_certified_results_pdf` recompute live from current `Vote.deleted_at`
and `ManualBallotBatch.status` on every call, so a void's effect on results
is identical whether it happens before or after close. There is therefore
no lifecycle race for a lock to prevent here — only the lock-ordering
deadlock, which is what this fix addresses.

**Fix:** the election row is now locked _first_ (`.with_for_update()`,
returning `"Election not found"` if the org/election pair doesn't resolve),
_before_ the batch lock, matching `delete_election`'s and (post-ELEC-24)
`attest_manual_ballot_batch`'s parent-to-child order. The subsequent votes
query no longer needs to join `Election` for its organization filter, since
the election is already locked and org-scoped by the new first query.
`close_election` never locks the batch, so this reorder introduces no new
deadlock risk on that path — same reasoning ELEC-24 documented for
attestation.

Guarded by `TestVoidManualBallotBatchLocksElectionFirst` (3 tests: lock
order across all three queries, election-not-found short-circuit, and the
already-voided short-circuit still working with the new first query) in
`tests/test_election_codex_round3.py`, confirmed to fail pre-fix via
`git stash`. The two pre-existing `TestVoidManualBallotBatchLocking` tests
in `tests/test_election_codex_round2.py` were updated to include the new
election-lock mock in their call sequence (the same treatment ELEC-24 gave
`TestAttestationLocksElection.test_election_read_is_locking`).

**Round 3: 1 fixed (ELEC-25).** The other two round-3 Codex findings were
documentation-accuracy findings with no code to fix — see the corrected
`.with_for_update()` inventory above and `PROGRESS.md` / `CHANGELOG.md`'s
corrected finding-id enumeration.

### ELEC-26 — P1 — Mixed-election item-skip decided before positional eligibility was computed, excluding a position-only-eligible voter — ✅ FIXED

**What:** `send_ballot_emails` computed `eligible_items` and, when a
recipient had zero of them, immediately `continue`d to the next recipient —
skipping them with no token and no email. That decision ran **before**
`eligible_positions` (added by ELEC-23, this same pass, round 2) was ever
computed. In a mixed election (an election with both `ballot_items` and
`positions` configured — the schema explicitly allows a candidate to be
nominated for a plain position untied to any item), a recipient who fails
every structured item's `eligible_voter_types` but qualifies for a
restricted plain position was excluded outright, even though
`eligible_positions` would have come back non-empty for them a few lines
later. ELEC-23 fixed the _token snapshot_ to include such a voter's
positions when it did run; this bug meant the code often never reached that
snapshot for exactly the voters it exists to cover.

**Impact:** an eligible voter for a plain-position contest (e.g. Secretary,
restricted to administrative members) never receives a ballot at all if they
also fail an unrelated item's voter-type restriction (e.g. a Board Seat
restricted to operational members) — no email, no token, no record in
`skipped_details` beyond "no eligible ballot items," which misdescribes the
real reason (they were never eligible for items in the first place; they
were eligible for a position). This can change the outcome of the position's
election by silently shrinking its electorate, and is invisible to the
secretary sending the ballot unless they cross-reference eligibility by hand.

**Where:** `election_service.py:6041-6073` pre-fix numbering (the ballot-items
empty check, computed and decided before the positions block that follows
it).

**Fix:** restructured so both `eligible_items` and `eligible_positions` are
computed in full before any skip decision is made. The skip decision itself
is now a single combined check: a recipient is skipped only when they
qualify for **neither** structure the election actually defines — a plain
position with no `position_eligibility` rules is unrestricted (everyone
qualifies), so it never triggers a skip on its own; a position with rules
requires appearing in `eligible_positions`; an election with ballot items
requires appearing in `eligible_items`. When both structures are defined and
the recipient fails both, the skip reason now says so explicitly ("Not
eligible for any ballot item or position in this election") rather than
reporting only the item-side failure. Guarded by
`TestMixedElectionItemFailureDoesNotSkipPositionEligible` (2 tests) in
`tests/test_election_codex_round4.py`, confirmed to fail pre-fix via
`git stash` (both tests failed: `sent == 0`, `skipped == 1` before the fix).

### ELEC-27 — P2 — `submit_ballot_with_token`'s NULL-position duplicate-vote check used the item's storage position, not its full candidate-position set — ✅ FIXED

**What:** `submit_ballot_with_token` already computes
`item_candidate_positions = ballot_item_candidate_positions(ballot_item)` —
the broader set of `Candidate.position` values that legitimately belong to a
ballot item, covering a legacy item's title-keyed candidates as well as its
own `position`/id (ELEC-22's helper). It uses that set correctly in the
rankings, multi-select, and plain-candidate-UUID validation branches a few
lines later. But the duplicate-vote check immediately above those branches —
the one guarding a pre-normalization `Vote.position IS NULL` row — still
filtered its inner candidate subquery on `Candidate.position == position`
(the single _storage_ value: the item's own `position` field, or the item id
when absent), not `item_candidate_positions`. This is the exact shape of gap
ELEC-22 fixed in the eligibility allow-list, reopened in the
duplicate-detection query that ELEC-22 didn't touch.

**Impact:** a voter with an old, pre-normalization vote (`position IS NULL`)
against a legacy item's title-keyed candidate, who also holds a second,
unused voting token for the same election, could submit a second vote for
that same contest. The old vote's candidate has `position == <title>`, but
the pre-fix subquery only matched `Candidate.position == <item id>` (since a
legacy item has no `position` field of its own) — so the existing vote was
invisible to the dedup check, the new vote was recorded and counted, and the
voter's real tally for that contest became two instead of one.

**Where:** `election_service.py:7743-7763` pre-fix numbering (the NULL-position
subquery inside the per-vote duplicate check).

**Fix:** the subquery's inner `Candidate` filter now uses
`Candidate.position.in_(item_candidate_positions)`, the same set already
used by every other candidate-validation branch in this method and by
ELEC-22's fix in `cast_vote_with_token` — one consistent definition of
"which positions belong to this item," not two that can drift. Guarded by
`TestSubmitBallotLegacyNullPositionDedup` (2 tests: the duplicate is now
caught, and a genuinely fresh voter is still unaffected) in
`tests/test_election_codex_round4.py`, confirmed to fail pre-fix via
`git stash` (the duplicate-submission test wrongly succeeded before the fix).

### ELEC-28 — P1 — The public ballot UI has no way to render or submit a plain-position contest, even for a mixed election the backend now correctly issues one for — 🚩 FLAGGED

**What:** ELEC-23 (round 2) and ELEC-26 (above) fixed the backend so that a
mixed election's `send_ballot_emails` correctly snapshots `eligible_positions`
on the token and issues a ballot to a recipient who qualifies for a plain
position, independent of their ballot-item eligibility. `/ballot/lookup`
(`lookup_ballot_by_token`) correctly returns that recipient's eligible
`election.positions` entries and their candidates. But
`frontend/src/pages/BallotVotingPage.tsx` — the only UI the public,
token-based ballot flow renders — derives its entire form from
`election.ballot_items` alone (`const ballotItems = election.ballot_items ||
[]`, `getCandidatesForItem`, `choices` keyed by `item.id`) and never reads
`election.positions` at all. Its single submission path,
`handleConfirmSubmit`, always POSTs to `/elections/ballot/vote/bulk`
(`submit_ballot_with_token`), which only accepts `ballot_item_id`-keyed
votes. The backend does expose a route shaped for a single positional vote —
`POST /elections/ballot/vote` (`cast_vote_with_token`) — but grepping the
frontend confirms it is never called from anywhere in `frontend/src`; the
only caller of the authenticated, non-token `ElectionBallot.tsx` component
(which _does_ render `election.positions`) is the logged-in
`electionService.castVote()` → `/elections/{id}/vote` path, a completely
separate, authenticated voting flow unrelated to the emailed-token ballot.

**Impact:** a member who is eligible for a plain-position contest in a mixed
election but ineligible for every structured ballot item now correctly
receives a ballot email and a live token (ELEC-26), but the page that token
opens shows **zero contests** — `ballotItems` is empty, so the item loop
renders nothing, and there is no rendering path for `election.positions` at
all. Worse, a member eligible for _both_ an item and a position sees only
the item; submitting that visible ballot spends the token
(`voting_token.used = True` in `submit_ballot_with_token`), and there is no
way back to cast the positional vote afterward — the token, which is
single-use by design (R-1), is gone. The net effect: through the product's
actual public ballot UI today, a plain-position contest inside a mixed
election cannot be voted on at all by an emailed-token recipient, regardless
of how correct the backend's eligibility computation is.

**Fix: not applied — this is a product/UX decision, not a mechanical bug.**
Investigated whether an existing code path could be safely reused rather
than designed from scratch, and concluded it cannot:

- `ElectionBallot.tsx` already renders `election.positions` and multiple
  voting methods, but it is wired to the **authenticated** flow
  (`electionService.checkEligibility`/`castVote` against
  `/elections/{id}/...`, which require a logged-in `current_user`) — it has
  no token awareness and cannot be dropped into the anonymous, token-based
  `BallotVotingPage.tsx` without rebuilding its eligibility and submission
  plumbing around a token instead of a session.
- The backend's single-vote token route, `POST /elections/ballot/vote`
  (`cast_vote_with_token`), is unused by any current frontend code — wiring
  it up is not "flip a flag," it's adding a first caller, with a rendering
  and per-position submission-state model `BallotVotingPage.tsx` does not
  have today (its `choices` state, confirmation summary, and validation are
  all keyed by ballot-item id).
- Both the bulk (`/ballot/vote/bulk`) and single (`/ballot/vote`) token
  routes mark the token `used = True` on completion (`election_service.py`,
  `submit_ballot_with_token` and `cast_vote_with_token` respectively) — the
  token is genuinely single-use. A ballot spanning both structures needs
  either one new combined endpoint or careful sequencing of two calls before
  the token is marked used, plus new UI state to hold both an item ballot
  and a position ballot in one confirmation step. That is a new ballot
  contract, not a routing fix.

Building this hastily on a live election/voting page risks getting ballot
semantics wrong in a way that is worse than the current gap (e.g., double
token use, a position vote silently dropped on partial failure, or
inconsistent confirmation-summary text) — exactly the class of mistake this
rotation's standard (see ELEC-14, ELEC-16) holds should be flagged for a
human product decision rather than guessed at during a security-review pass.
Mirrored to `docs/KNOWN_LIMITATIONS.md`.

**Round 4: 2 fixed (ELEC-26, ELEC-27), 1 flagged (ELEC-28).** Findings
posted by Codex against commit `dab1d1baf` (before round 3's `53c81b92a`) —
round 3 did not touch this code, so both backend findings were still open
against current code. Both confirmed real by tracing the actual functions
(not taken on Codex's word) and fixed with regression tests that fail
pre-fix via `git stash`. The third (frontend) finding was investigated in
full, confirmed real, and flagged per the standard above rather than forcing
a rushed UI change into a security-review PR.

**Completion gate (pass 3, after round 4):**

| Check                                                                                                                   | Result                                                                      |
| ----------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `flake8 app/ tests/ alembic/`                                                                                           | ✅ 0 violations                                                             |
| `black --check app/ tests/ alembic/`                                                                                    | ✅ clean                                                                    |
| `isort --check-only app/ tests/ alembic/` (9.0.1, CI's pin)                                                             | ✅ clean                                                                    |
| `python3 scripts/validate_migrations.py --strict`                                                                       | ✅ 409 revisions, single head (`f7b3c8d2e569`) — no migration in this round |
| `pytest tests/ -q -k "election or ballot or vote or quorum"`                                                            | ✅ 479 passed, 1 skipped (pre-existing `py_vapid` optional dep), 0 failed   |
| `pytest tests/test_election_codex_round2.py tests/test_election_codex_round3.py tests/test_election_codex_round4.py -q` | ✅ 27 passed, 0 failed                                                      |
| `pytest tests/ -q` (full backend suite)                                                                                 | ✅ 9799 passed, 21 skipped (pre-existing/environmental), 0 failed           |
| `tsc --noEmit` / `eslint .`                                                                                             | not run — no frontend file changed this round (ELEC-28 flagged, not fixed)  |

New guard tests: `tests/test_election_codex_round2.py` (2 new/updated tests
for ELEC-24's lock-order fix, plus this round's update to
`TestVoidManualBallotBatchLocking`'s two tests for ELEC-25's new election
lock), `tests/test_election_codex_round3.py` (7 tests across ELEC-22 and
ELEC-23, plus 3 new tests for ELEC-25), and `tests/test_election_codex_round4.py`
(new file, 4 tests: 2 for ELEC-26, 2 for ELEC-27).
`tests/test_election_codex_fixes.py`'s `TestTokenVoteNullPositionDedup._token()`
stub was also given an explicit `eligible_item_ids=None` default — ELEC-21's
fix reads that attribute unconditionally (as the real `VotingToken` model
always has it), which a stub predating the field did not.

### ELEC-29 — P1 — A colliding position name let a scope-restricted vote bypass its eligibility check — ✅ FIXED

**What:** `cast_vote_with_token` (`backend/app/services/election_service.py`,
~line 7360) classifies a candidate as "item-scoped" the moment its position
resolves to _any_ ballot item, via a `next(...)` first-match lookup over
`election.ballot_items` using `ballot_item_candidate_positions()` (the
ELEC-22 helper: an item's own `"position"` field, or its title/id fallback
for a legacy item persisted without one). When `matching_item` was found,
the code checked only `voting_token.eligible_item_ids` and **never**
consulted `voting_token.eligible_positions` at all — even when the same
position value was _also_ a plain `election.positions` entry governed by
`position_eligibility`. The public `/ballot/lookup` endpoint
(`lookup_ballot_by_token` in `backend/app/api/v1/endpoints/elections.py`)
had the same shape: a candidate whose position appeared in the union of all
ballot items' claimed positions (`all_item_positions`) was exempted from the
`eligible_positions` filter unconditionally, with no check for whether that
same position also appeared in the plain `election.positions` list.

Verified this collision is reachable, not just theoretical:

1. **No schema validator forbids it.** `ElectionBase`/`ElectionUpdate` in
   `app/schemas/election.py` validate `positions` for internal uniqueness
   (`validate_positions`) and `ballot_items` for unique ids
   (`validate_unique_ballot_item_ids`) — nothing cross-checks a plain
   position string against any ballot item's `position`/`title`/`id`. An
   election can be created or updated with a plain position `"Secretary"`
   and a separate, legacy-shaped ballot item (no explicit `"position"`
   field) titled `"Secretary"` in the same request.
2. **Token issuance produces the exact mismatched-scope token Codex
   described.** `send_ballot_emails` computes `eligible_item_ids` (from each
   item's own `eligible_voter_types`) and `eligible_positions` (from
   `position_eligibility`) **independently** — nothing ties them together.
   A recipient who fails the plain position's voter-type rule but qualifies
   for the unrestricted, same-named legacy item gets a token with
   `eligible_item_ids` containing that item and `eligible_positions = []`
   (empty, not `None` — the recipient was evaluated and found ineligible).
3. **The candidate is a single row that legitimately serves both
   namespaces.** `Candidate.position` is one string column; a candidate
   stored as `position="Secretary"` is claimed by both the plain position
   and the colliding item's title fallback at once — there is nothing
   inconsistent about the data, only about which check the classification
   logic chose to run.

With all three confirmed, the token above could call
`POST /elections/ballot/vote` for the "Secretary" candidate and succeed,
despite `eligible_positions` explicitly excluding "Secretary" — an
authorization bypass on a restricted position via an unrelated, unrestricted
ballot item that merely shares its name.

**Why "require both" (not "reject the collision at write time"):** the task
that opened this finding named two candidate fixes. Rejecting the collision
at schema/write time was ruled out: `ElectionUpdate` fields are independently
optional and merged against whatever the row already holds, so validating
"no collision" would require the schema layer to know the row's _existing_
`positions` or `ballot_items` (whichever the request doesn't touch) — that
validation belongs in the service layer against the merged effective state,
not in a Pydantic model with no DB access, and retrofitting it risks
rejecting elections that already exist in this exact shape with no way to
migrate them cleanly. Requiring both scopes to authorize a colliding
candidate closes the bypass without touching write-time validation or any
existing election's stored configuration — it only ever makes an ambiguous
candidate _more_ restricted than before, never less, so no previously-valid
vote by a fully-eligible voter can regress.

**Fix:** at both call sites, the collision is now detected directly —
`effective_position in election.positions` (service) /
`c.position in all_plain_positions` (endpoint, snapshotted before
`eligible_positions` filtering mutates `response.positions`) — instead of
inferring scope from whichever branch a `next()`/set-union lookup happened
to resolve first:

- `cast_vote_with_token`: the existing item-eligibility check
  (`eligible_item_ids`) still runs whenever `matching_item` is found. The
  position-eligibility check now also runs whenever the candidate is _not_
  item-scoped **or** its position collides with a plain `election.positions`
  entry — so a colliding candidate must clear both checks, and a
  non-colliding item-scoped candidate is unaffected (unchanged behavior,
  preserving the documented reason `eligible_positions` is skipped for a
  genuine item-only candidate: its position rarely appears in
  `election.positions`, so applying that filter there would reject
  legitimate item votes outright).
- `lookup_ballot_by_token`: the final `eligible_positions` filter no longer
  exempts a candidate just because its position is in `all_item_positions`
  — it exempts it only when that position is _not also_ a plain
  `election.positions` entry. The earlier `eligible_item_ids` filter is
  unchanged, so a colliding candidate must still pass both filters in
  sequence, mirroring the service-layer fix.
- `submit_ballot_with_token` was checked and needs no change: it resolves
  votes by an explicit client-supplied `ballot_item_id` looked up in
  `item_map`, never by classifying a bare position string, so the
  "which scope does this position belong to" ambiguity does not arise there
  — `allowed_item_ids` is checked directly against the id the client
  supplied. `check_voter_eligibility`/`cast_vote` (the authenticated,
  non-token flow) were also checked and already apply both the
  `position_eligibility` check (lines ~1002-1019) and the ballot-item
  `eligible_voter_types`/attendance check (lines ~1022-1054) unconditionally
  when a `position` is passed — no either/or branching, so no bypass exists
  there.

New regression tests: `tests/test_election_codex_round5.py` (new file, 3
tests) — one election fixture with a plain `"Secretary"` position
(`position_eligibility` restricted to `administrative`) and an unrestricted
legacy ballot item also titled `"Secretary"`, and a single candidate whose
`position="Secretary"` is claimed by both. Confirmed failing pre-fix via
`git stash` on the two service/endpoint files: a token eligible for the item
but not the position could both see the candidate via `/ballot/lookup` and
cast a vote for it via `cast_vote_with_token`; a third sanity test confirms
a token eligible under _both_ scopes is unaffected — the fix does not
over-reject.

**Round 5: 1 fixed (ELEC-29).** The one finding posted against commit
`53c81b92a` (before round 4's `67511fa77`) — round 4 did not touch this
code, so it was still open against current code. Confirmed real by tracing
`cast_vote_with_token`, `lookup_ballot_by_token`, `submit_ballot_with_token`,
`check_voter_eligibility`/`cast_vote`, the schema validators, and
`send_ballot_emails`'s token-issuance logic, and fixed uniformly at both
vulnerable call sites with a "require both scopes when they collide"
approach rather than a write-time rejection (see the "Why" note above for
the tradeoff).

**Completion gate (pass 3, after round 5):**

| Check                                                        | Result                                                                    |
| ------------------------------------------------------------ | ------------------------------------------------------------------------- |
| `flake8 app/ tests/ alembic/`                                | ✅ 0 violations                                                           |
| `black --check app/ tests/ alembic/`                         | ✅ clean                                                                  |
| `isort --check-only app/ tests/ alembic/` (9.0.1, CI's pin)  | ✅ clean                                                                  |
| `python3 scripts/validate_migrations.py --strict`            | ✅ 409 revisions, single head (`f7b3c8d2e569`) — no migration this round  |
| `pytest tests/ -q -k "election or ballot or vote or quorum"` | ✅ 482 passed, 1 skipped (pre-existing `py_vapid` optional dep), 0 failed |
| `pytest tests/test_election_codex_round5.py -q`              | ✅ 3 passed, 0 failed (2 confirmed failing pre-fix via `git stash`)       |
| `pytest tests/ -q` (full backend suite)                      | ✅ 9802 passed, 21 skipped (pre-existing/environmental), 0 failed         |
| `tsc --noEmit` / `eslint .`                                  | not run — no frontend file changed this round                             |

New guard tests: `tests/test_election_codex_round5.py` (new file, 3 tests
for ELEC-29).

### ELEC-30 — P1 — The positional-eligibility snapshot never applied the global membership-tier voting ban — ✅ FIXED

**What:** Round 4's ELEC-26 fix taught `send_ballot_emails`
(`backend/app/services/election_service.py`, ~line 6123) to snapshot which
of an election's plain `positions` a recipient may vote for, mirroring the
per-item snapshot already computed via `_get_eligible_ballot_items_for_user`
→ `annotate_ballot_items_for_user`. The item side always checks the
member's membership-tier `benefits.voting_eligible` flag first — a member
on a tier with `voting_eligible: False` (the shipped "probationary" tier is
one) fails **every** ballot item, regardless of that item's own
`eligible_voter_types` rule. The new positional snapshot never performed
this check at all: `if not pos_rules: eligible_positions.append(pos)`
(unrestricted position) and the per-position `voter_types` check both ran
with no reference to the recipient's tier, so a globally
voting-ineligible member could still be appended to `eligible_positions`
for any unrestricted or role-eligible position.

**Verified reachable:** confirmed by reading `annotate_ballot_items_for_user`
(lines 458-464 pre-fix) against the new positional block side by side — the
item path computes `tier_voting_eligible` and gates on it before any
per-item rule runs; the positional block never referenced it. A recipient
whose `membership_type` resolves to a tier with `voting_eligible: False`
in a mixed election with at least one plain position therefore received a
token with `eligible_item_ids = []` (correctly banned from items) but a
non-empty `eligible_positions` (incorrectly granted a live positional
credential) whenever that election had an unrestricted position or a
position whose `voter_types` happened to match the member's role.

**Fix:** extracted the item path's tier check (and ELEC-31's override
check) into a new shared helper, `ElectionService._member_voting_gates()`,
returning `(tier_voting_eligible, has_override)` for a given user/election.
`annotate_ballot_items_for_user` now calls it instead of computing the same
two booleans inline (no behavior change there — same computation, one
definition). The positional block now calls it too: when
`tier_voting_eligible` is `False` and the recipient has no override,
`eligible_positions` is set to `[]` outright — an empty, evaluated list
(not `None`/unrestricted) — before any per-position rule is even
considered, mirroring `annotate_ballot_items_for_user` failing every item
for the same member. A globally banned member with no overriding
ballot-item eligibility is therefore skipped entirely by the existing
"empty ballot prevention" logic further down the same function, receiving
no token at all — exactly the outcome a globally banned member already
gets on the item-only side.

### ELEC-31 — P1 — An election voter override didn't reach the positional-eligibility snapshot — ✅ FIXED

**What:** `annotate_ballot_items_for_user` treats an entry in
`election.voter_overrides` naming the recipient (the "secretary override")
as blanket eligibility for every ballot item, bypassing that item's
`eligible_voter_types` rule entirely. The positional snapshot added by
ELEC-26 never consulted `voter_overrides` at all, so an overridden
recipient whose role failed a restricted position's `voter_types` rule
still had that position silently excluded from `eligible_positions` — the
opposite of what the override is supposed to do. Concretely: an
overridden recipient in a mixed election got a token with
`eligible_item_ids` covering every ballot item (override honored) and
`eligible_positions` omitting every position they fail on the normal
role rules (override ignored) — `/ballot/lookup` would hide those
positions and `cast_vote_with_token` would reject a vote for them,
contradicting the override's contract as enforced on the item side of the
exact same ballot.

**Fix:** the same `_member_voting_gates()` helper introduced for ELEC-30
also returns `has_override`. The positional block now checks it first, per
position: when `has_override` is `True`, every position in
`election.positions` is appended to `eligible_positions` unconditionally,
before either the "no rules configured" or the `voter_types` branch runs —
the positional mirror of `annotate_ballot_items_for_user`'s `if
has_override: pass` short-circuit. An overridden recipient's positional
snapshot can therefore never be narrower than an unrestricted one, matching
the override's existing effect on ballot items.

New regression tests for ELEC-30/31 in `tests/test_election_codex_round6.py`
(`TestGloballyIneligibleTierExcludesPositions`,
`TestVoterOverrideAppliesToPositions`) — confirmed failing pre-fix via
`git stash` on `election_service.py`: the tier test found `sent == 1` (a
live token issued) where the fix requires `sent == 0`; the override test
found `token_row.eligible_positions == []` where the fix requires
`["President"]`, and a follow-up test exercises the actual token
`send_ballot_emails` issues end-to-end through `cast_vote_with_token` to
confirm the override-eligible positional vote is accepted, not just
present in the snapshot.

### ELEC-32 — P2 — `cast_vote_with_token`'s completion check ignored outstanding ballot-item votes in a mixed election — ✅ FIXED

**What:** `cast_vote_with_token`'s "mark this token fully used" logic
(`backend/app/services/election_service.py`, ~line 7634 pre-fix) computed
`election_positions` from `voting_token.eligible_positions` (falling back
to `election.positions`) and considered the token complete once
`positions_voted` covered that set. It never referenced
`voting_token.eligible_item_ids` at all — even though this same single-vote
route also accepts item-scoped candidates (via the `matching_item` branch
above it, per ELEC-21/ELEC-29) and records their effective position into
the identical `positions_voted` list. In a mixed simple-majority election
where a recipient is eligible for at least one ballot item **and** a
strict, non-empty subset of the plain positions, casting the last eligible
_position_ vote first satisfied `election_positions` and set `used = True`
immediately — while the eligible item vote was still outstanding. The
follow-up item vote was then rejected by `get_ballot_by_token` with "This
ballot has already been fully submitted," even though it was a legitimate,
never-cast vote the recipient was entitled to.

**Verified reachable:** confirmed by tracing the two branches side by side
— `matching_item is None or is_plain_position` is not required for the
item vote to land in `positions_voted`; any item-scoped candidate's
`effective_position` is appended there regardless. The completion check
below it, however, only ever measured `election_positions`
(`eligible_positions`/`election.positions`), never the item side, so a
token restricted to a strict subset of positions plus one or more eligible
items could reach "used" purely from the positional votes.

**Fix:** the completion set now folds in every eligible ballot item's
candidate-position label(s) — using the same `ballot_item_candidate_positions()`
helper ELEC-22/ELEC-27/ELEC-29 already rely on for "which position values
belong to this item" — alongside `election_positions`, before deciding
completion. `voting_token.eligible_item_ids is None` (legacy/unrestricted
token) is treated the same way the existing `eligible_positions is None`
case already is: every ballot item counts, not zero. "Ballot fully cast"
now requires `positions_voted` to cover the union of both scopes, so a
token cannot be marked used while either an eligible position or an
eligible item remains unvoted, and casting either scope first can never
foreclose the other.

New regression tests in `tests/test_election_codex_round6.py`
(`TestMixedTokenStaysLiveUntilBothScopesCovered`) — confirmed failing
pre-fix via `git stash`: casting the eligible position first flipped
`used` to `True` immediately (asserted `False`), and the follow-up item
vote was rejected with "already been fully submitted" (asserted accepted,
with the token only then flipping to `used = True`).

**Round 6: 3 fixed (ELEC-30, ELEC-31, ELEC-32).** All three findings posted
by Codex against commit `67511fa77` (round 4's own fix commit) in the
mixed-election positional-eligibility code that fix introduced — round 5
touched a different function (`cast_vote_with_token`'s candidate
classification, ELEC-29) and did not touch this code, so all three were
still open against current code. All three confirmed real by reading the
flagged code against its item-side counterpart line by line (not taken on
Codex's word), fixed by extracting the item side's two universal gates
(tier ban, override) into a shared `_member_voting_gates()` helper reused
by both scopes (ELEC-30/31), and by widening `cast_vote_with_token`'s
completion set to cover both scopes at once (ELEC-32) — one root cause
(the positional path computed independently of, and more permissively
than, the item path's established gates) addressed uniformly rather than
patched finding by finding.

**Completion gate (pass 3, after round 6):**

| Check                                                        | Result                                                                    |
| ------------------------------------------------------------ | ------------------------------------------------------------------------- |
| `flake8 app/ tests/ alembic/`                                | ✅ 0 violations                                                           |
| `black --check app/ tests/ alembic/`                         | ✅ clean                                                                  |
| `isort --check-only app/ tests/ alembic/` (9.0.1, CI's pin)  | ✅ clean                                                                  |
| `python3 scripts/validate_migrations.py --strict`            | ✅ 409 revisions, single head (`f7b3c8d2e569`) — no migration this round  |
| `pytest tests/ -q -k "election or ballot or vote or quorum"` | ✅ 487 passed, 1 skipped (pre-existing `py_vapid` optional dep), 0 failed |
| `pytest tests/test_election_codex_round6.py -q`              | ✅ 5 passed, 0 failed (all 5 confirmed failing pre-fix via `git stash`)   |
| `pytest tests/ -q` (full backend suite)                      | ✅ 9807 passed, 21 skipped (pre-existing/environmental), 0 failed         |
| `tsc --noEmit` / `eslint .`                                  | not run — no frontend file changed this round                             |

New guard tests: `tests/test_election_codex_round6.py` (new file, 5 tests:
1 for ELEC-30, 2 for ELEC-31, 2 for ELEC-32).

### ELEC-33 — P1 — `submit_ballot_with_token` never enforced positional scope for a ballot item colliding with a restricted plain position — ✅ FIXED

**What:** Round 5's ELEC-29 fix closed the position/ballot-item
namespace-collision bypass in `cast_vote_with_token` (the single-vote
`/ballot/vote` route) and `lookup_ballot_by_token` (the `/ballot/lookup`
route): both detect when a ballot item's position/title/id collides with a
plain `election.positions` entry and require the candidate to clear
`eligible_positions` too, not just `eligible_item_ids`. `submit_ballot_with_token`
(the bulk `/ballot/vote/bulk` route, `backend/app/services/election_service.py`,
~line 7928 pre-fix) was never touched by that fix and had the identical
gap: its per-item eligibility check only ever consulted
`voting_token.eligible_item_ids`. A token eligible for a colliding item but
NOT eligible for the colliding plain position (`eligible_positions=[]`, or
a list that omits it) could still submit that position's candidate through
the bulk route — the exact ELEC-29 scenario, reachable through the one
call site ELEC-29 didn't fix.

**Verified reachable:** confirmed by tracing `submit_ballot_with_token`'s
per-vote loop side by side with `cast_vote_with_token`'s post-ELEC-29 logic.
Nothing in schema validation (`ElectionBase`/`ElectionUpdate` in
`app/schemas/election.py`) prevents the collision (still true post-ELEC-29 —
that fix was runtime-only, deliberately, per its own "Why" note), and
`send_ballot_emails` still computes `eligible_item_ids` and
`eligible_positions` independently, so the mismatched-token shape ELEC-29's
own regression test constructs is producible for real. Reproduced with a
regression test (`TestBulkRouteEnforcesPositionalScopeForCollidingItem` in
`tests/test_election_codex_round7.py`) that fails pre-fix: a token eligible
for an unrestricted legacy item titled "Secretary" but ineligible for the
restricted plain "Secretary" position submits the colliding candidate
through the bulk route with no error, and a `Vote` row is persisted.

**Fix:** extracted the collision check into a shared module-level
`_token_eligibility_error()` helper in `election_service.py`, used by both
`cast_vote_with_token` and `submit_ballot_with_token`, so this logic is
defined exactly once rather than re-implemented a third time. Fixing it
this way also corrected a latent gap in the collision check itself: the
original ELEC-29 code detected a collision by testing whether the single
resolved `effective_position` value was literally present in
`election.positions`. That works for `cast_vote_with_token` (whose
resolved value is always one of the item's own aliases, by construction of
the `matching_item` lookup), but the bulk route resolves a _legacy_ item's
position to the item's id (`ballot_item.get("position") or ballot_item_id`)
— an opaque id can never itself equal a human-readable plain position name,
even though the item's _title_ does. The shared helper instead checks every
alias in `ballot_item_candidate_positions(item)` against `election.positions`
and, when one collides, checks `eligible_positions` against that colliding
alias rather than whichever literal the caller happened to resolve —
correct for both routes, and a strict improvement (not a behavior change)
for `cast_vote_with_token`'s pre-existing, narrower check.

New regression tests in `tests/test_election_codex_round7.py`
(`TestBulkRouteEnforcesPositionalScopeForCollidingItem`) — confirmed
failing pre-fix via `git stash`: the mismatched token's bulk submission
succeeded and persisted a vote (asserted rejected with no vote persisted);
a sanity test confirms a token eligible under both scopes still succeeds
(unaffected either side of the fix, guarding against over-rejection).

### ELEC-34 — P1 — A legacy ballot item's votes didn't dedup across the single-vote and bulk routes — ✅ FIXED

**What:** For a ballot item with no explicit `position` field (a "legacy"
item, per ELEC-22's title-or-id fallback,
`ballot_item_candidate_positions()`), the two vote-submission routes stored
(and hashed) two different literal `Vote.position` values for the same
logical contest: `submit_ballot_with_token` (bulk route) always stores the
item's id (`ballot_item.get("position") or ballot_item_id`), while
`cast_vote_with_token` (single-vote route) falls back to the resolved
candidate's own `.position` value — historically the item's _title_, since
that is how legacy-item candidates are actually created. A voter holding
two unused tokens for the same election could cast one vote through each
route for this item: each route's pre-insert duplicate-vote SELECT
compared only against its own convention (`Vote.position == position`),
never the other route's literal, and each route's `vote_dedup_hash` — the
database-level UNIQUE-constraint backstop the code explicitly documents as
protecting "even if a race condition bypasses application checks" —
likewise embedded the differing literal, so the two votes hashed
differently and the constraint didn't catch it either. ELEC-27 (round 2)
had already broadened the _historical_ `Vote.position IS NULL` dedup
subquery to use `ballot_item_candidate_positions()`, but that only covers
rows written before position normalization; these are two _current_,
non-NULL rows from the two live routes, which ELEC-27 never addressed.

**Verified reachable:** confirmed by reading exactly what each route writes
to `Vote.position` for a legacy item and what each route's duplicate query
filters on — see the "What" paragraph above; both are directly readable in
`election_service.py` with no reachability caveats. Reproduced with
regression tests in `tests/test_election_codex_round7.py`
(`TestLegacyItemVoteDedupAcrossBothRoutes`) that fail pre-fix in both
directions: a bulk vote followed by a single-vote-route vote for the same
legacy item both succeed (asserted the second is rejected), and the
reverse order also both succeed (asserted the same).

**Fix, two layers (both changed, per the "and/or" in the finding — neither
alone is defense in depth without the other):**

1. **Read-time — widened both routes' duplicate-vote SELECT** to match
   every alias in `ballot_item_candidate_positions(item)`
   (`Vote.position.in_(item_candidate_positions)` /
   `Vote.position.in_(position_aliases)`) instead of comparing against a
   single literal. This is a superset of what each route already matched
   (a legacy item's alias set always contains that route's own
   convention), so it only widens what counts as "already voted," never
   narrows it — no existing passing test asserts a specific pair of
   distinct votes must both be accepted for the same legacy item.
2. **Write-time — normalized the `vote_dedup_hash` position component**
   via a new `_dedup_position_key()` helper: for a legacy item (no
   explicit `position` field) the hash always uses the item's id —
   already the bulk route's existing convention, so only
   `cast_vote_with_token`'s hash computation changed — regardless of which
   route computed it. This is deliberately scoped to the _hash_ only, not
   the stored `Vote.position` display value itself: `Vote.position`
   keeps each route's existing convention (unaffected — no change to
   error messages, per-position result grouping, or `positions_voted`
   completion tracking, none of which this finding was about), while the
   hash — used solely for the database's uniqueness constraint — is now
   identical across routes for the same contest. This closes the residual
   concurrent-race gap the SELECT-based fix alone cannot: two truly
   simultaneous submissions through different tokens would both read an
   empty pre-insert SELECT no matter how it's widened, so the UNIQUE
   constraint on `vote_dedup_hash` is the only backstop that can still
   catch that shape — and only if both routes compute the same hash.

Existing pre-fix rows keep whichever literal they were written with — no
migration, consistent with ELEC-27's read-time-only precedent — and remain
covered because the widened SELECT matches every alias, not just the
post-fix canonical one.

New regression tests in `tests/test_election_codex_round7.py`
(`TestLegacyItemVoteDedupAcrossBothRoutes`) — confirmed failing pre-fix via
`git stash` (both ordering tests, plus a hash-parity unit test that failed
pre-fix with `ImportError` since `_dedup_position_key` didn't exist yet).

### ELEC-35 — P1 — The positional tier ban only applied when a `position_eligibility` rule existed for the position, not whenever the election defines positions at all — ✅ FIXED

**What:** Round 6's ELEC-30 fix made the positional-eligibility snapshot
in `send_ballot_emails` call `_member_voting_gates()` — the same global
membership-tier voting ban `annotate_ballot_items_for_user` already
applies to ballot items — but only inside the
`if election.positions and election.position_eligibility:` branch. Round
6's own fixture covered a position with an _empty rule_ (`{"President":
{}}` — `position_eligibility` truthy, just no restriction for that one
position). It did not cover an election with plain positions and **no**
`position_eligibility` configured at all (a falsy `{}` or `None`) — a
distinct condition that skipped the branch, and therefore the tier-gate
call, entirely. `eligible_positions` was left at its `None` default in
that case, which the vote path (`cast_vote_with_token`'s
`voting_token.eligible_positions is not None` checks) reads as
unrestricted. This surfaced during triage of ELEC-33/34, not as a
Codex-posted finding against a specific commit.

**Impact:** a member on a membership tier with `benefits.voting_eligible
== False` (e.g. the shipped "probationary" tier), on an election that
defines plain positions but configures no position-eligibility rules for
any of them, still received a live token with `eligible_positions=None` —
an unrestricted credential — and could cast a counted positional vote
despite the tier ban that already excludes them from every ballot item on
the exact same election.

**Where:** `election_service.py`, `send_ballot_emails`'s positional
snapshot: `if election.positions and election.position_eligibility:`
gated the entire tier/override check.

**Fix:** the gate now runs on `if election.positions:` alone —
`_member_voting_gates()` is evaluated whenever the election defines any
plain position, independent of whether `position_eligibility` happens to
be configured for it. `eligible_positions` is now always a list (never
left at `None`) whenever `election.positions` is set: empty when the tier
is banned and there is no override, otherwise populated per position
using `(election.position_eligibility or {}).get(pos)` (absent rules ->
unrestricted, same as before) so a tier-eligible member's behavior is
unchanged. The downstream empty-ballot-prevention `qualifies` computation
was simplified to match — it now reads `eligible_positions` directly
rather than carrying a separate "positions_unrestricted always qualifies"
carve-out that predates this fix and would otherwise still let a
tier-banned member's now-correctly-empty snapshot be overridden back to
"qualifies" for skip-decision purposes.

New regression tests in `tests/test_election_codex_round7.py`
(`TestTierBanAppliesWithoutAnyPositionEligibilityRules`, 2 tests) —
confirmed failing pre-fix via `git stash`: the banned-member test found
`sent == 1` (a live token issued) where the fix requires `sent == 0`. One
pre-existing test file (`test_election_reopen_test_ballots.py`) required a
one-line mock fixup — its hand-built `organization` `SimpleNamespace`
lacked a `.settings` attribute, which `_member_voting_gates()` now always
reads once `election.positions` is set.

### ELEC-36 — P1 — The ELEC-33 collision check picked an arbitrary colliding position when a legacy item collided with two different plain positions at once — ✅ FIXED

**What:** Round 7's ELEC-33 fix added `_token_eligibility_error()`, which
detects when a ballot item's position/title/id collides with a restricted
plain `election.positions` entry and, when it does, checks
`voting_token.eligible_positions` against the colliding label. For a
legacy item (no explicit `position` field), `ballot_item_candidate_positions()`
returns up to two aliases — the item's `title` and its `id` — either of
which can independently collide with a configured plain position. The fix
computed `colliding_positions = item_aliases & set(election.positions)`
correctly, but then selected which one to check with
`next(iter(colliding_positions))` — an arbitrary member whenever the set
has more than one element, since Python set iteration order depends on
hash seeding, not on which alias this particular vote is actually for.

**Impact:** an item `{"id": "Treasurer", "title": "Secretary"}` (no
`position` field) where both "Treasurer" and "Secretary" are also
independently configured, independently restricted plain positions in
`election.positions`. A token eligible for "Treasurer" but explicitly
NOT eligible for "Secretary" could, depending only on hash-seed luck, have
its candidate checked against "Treasurer" (passes) instead of "Secretary"
(the alias the check actually needed to enforce) — bypassing Secretary's
positional eligibility restriction and casting a counted vote the token
was never granted.

**Verified reachable:** `BallotItemInput.id` (`app/schemas/election.py`)
accepts any string matching `^[A-Za-z0-9_-]+$` up to 100 characters — a
value like `Treasurer` is valid — and `title` has no validator preventing
it from equaling a different `election.positions` entry, nor is there any
cross-field check preventing an item's `id` and `title` from each equaling
a _different_ member of `election.positions` at once. Nothing in
`ElectionBase`/`ElectionUpdate` restricts `positions` from containing both
values simultaneously either (this is the same absence of exclusivity
ELEC-29 and ELEC-33 already documented — deliberate, since a ballot item
and a plain position are allowed to legitimately share eligibility rules
by name). Reproduced with a regression test
(`TestMultiCollisionRequiresEligibilityForEveryColludingPosition` in
`tests/test_election_codex_round8.py`) that fails pre-fix: a token
eligible for "Treasurer" (one colliding alias) but not "Secretary" (the
other) submits the colliding candidate through the bulk route
(`submit_ballot_with_token`) with no error, and a `Vote` row is persisted.

**Fix:** `_token_eligibility_error()` now requires the token to be
eligible for **every** colliding position, not one arbitrarily chosen
member of the set — failing closed on the ambiguity (which alias is "the"
position this vote is for is inherently unresolvable from a legacy item
alone; that ambiguity is exactly why both aliases are matched at all)
rather than guessing. For the pre-existing single-collision case
(`len(colliding_positions) == 1`) this is byte-identical to the prior
behavior — only the 2+-alias case changes. Confirmed via grep that
`_token_eligibility_error()` has exactly two call sites
(`cast_vote_with_token` and `submit_ballot_with_token`), both already
routed through the shared helper per ELEC-33's own centralization goal, so
this one change closes the gap in both routes at once with no third call
site to drift.

New regression tests in `tests/test_election_codex_round8.py`
(`TestMultiCollisionRequiresEligibilityForEveryColludingPosition`, 3
tests) — confirmed one fails pre-fix via `git stash` (the token eligible
for "Treasurer" but not "Secretary" was wrongly accepted, `result is not
None`); the mirror-image test (eligible for "Secretary" but not
"Treasurer") and a sanity test (eligible for both, must still succeed)
guard against the fix over-rejecting. Both directions are asserted in the
same test module/process specifically so that whichever alias hash-seed
luck would have favored, at least one direction demonstrably failed
pre-fix — the bug's own non-determinism can't hide behind a single
lucky test run.

**Round 7: 3 fixed (ELEC-33, ELEC-34, ELEC-35).** The first two findings
were posted by Codex against commit `44fcbfe8e` (round 5's own fix commit)
about gaps in that fix (and, for ELEC-34, round 2's ELEC-27 fix)
specifically in `submit_ballot_with_token`, which neither earlier round's
diff touched — both were still open against current code. The third
surfaced during triage of the first two, in the positional-eligibility
snapshot round 6 (ELEC-30) already touched. All three confirmed real by
tracing the affected code path against its sibling (the bulk route against
the single-vote route's post-ELEC-29 logic; the "no rules configured"
branch against round 6's "empty rule" branch) rather than taking a
paraphrase as final, and fixed by consolidating the collision check into
one shared helper (`_token_eligibility_error`, ELEC-33), normalizing the
dedup-hash position key at the one write path that diverged from the
established convention (`_dedup_position_key`, ELEC-34), and widening the
tier-gate condition from "positions AND rules configured" to "positions
alone" (ELEC-35) — each fix reduces, rather than adds to, the number of
independent places its underlying invariant ("which position values
belong to this contest," "who may vote for a plain position at all") is
implemented, so a later call site is less likely to drift the way these
did.

**PR split note:** #2162 merged (rounds 1-6 through commit `c4e0e7eb2`)
while this round's fix was still in progress on its branch — a genuine
race with this rotation's own "one PR at a time" process, not a process
violation. All three round-7 review threads were replied to and resolved
on #2162 as normal (GitHub accepts both on a merged PR), but the code fix
itself landed in a new PR, [#2173](https://github.com/thegspiro/the-logbook/pull/2173),
branched from #2162's final commit (already an ancestor of `main` by the
time #2173 was opened) and merged forward onto current `main`.

**Completion gate (pass 3, after round 7, ELEC-33/34/35):**

| Check                                                        | Result                                                                    |
| ------------------------------------------------------------ | ------------------------------------------------------------------------- |
| `flake8 app/ tests/ alembic/`                                | ✅ 0 violations                                                           |
| `black --check app/ tests/ alembic/`                         | ✅ clean                                                                  |
| `isort --check-only app/ tests/ alembic/` (9.0.1, CI's pin)  | ✅ clean                                                                  |
| `python3 scripts/validate_migrations.py --strict`            | ✅ 409 revisions, single head (`f7b3c8d2e569`) — no migration this round  |
| `pytest tests/ -q -k "election or ballot or vote or quorum"` | ✅ 494 passed, 1 skipped (pre-existing `py_vapid` optional dep), 0 failed |
| `pytest tests/test_election_codex_round7.py -q`              | ✅ 7 passed, 0 failed                                                     |
| `pytest tests/ -q` (full backend suite)                      | ✅ 9814 passed, 21 skipped (pre-existing/environmental), 0 failed         |
| `tsc --noEmit` / `eslint .`                                  | not run — no frontend file changed this round                             |

New guard tests: `tests/test_election_codex_round7.py` (7 tests total: 2
for ELEC-33, 3 for ELEC-34 — one of which is a pure unit test of
`_dedup_position_key` with no DB fixture — and 2 for ELEC-35).

**Round 8: 1 fixed (ELEC-36).** Posted by Codex against commit
`097f1c37e` (round 7's own ELEC-33 fix commit) about a bug in that fix's
collision-detection logic — verified real by reading the actual
`_token_eligibility_error()` implementation and confirming the multi-alias
collision scenario is reachable through the schema, not by taking the
paraphrase as final. This is the third round of scrutiny on this specific
invariant (ELEC-29 opened it, ELEC-33 partially fixed it while
introducing this gap, ELEC-36 closes it) — fixed by making the check
exhaustive over every colliding alias rather than adding a fourth
special case.

**Completion gate (pass 3, after round 8, ELEC-36):**

| Check                                                        | Result                                                                    |
| ------------------------------------------------------------ | ------------------------------------------------------------------------- |
| `flake8 app/ tests/ alembic/`                                | ✅ 0 violations                                                           |
| `black --check app/ tests/ alembic/`                         | ✅ clean                                                                  |
| `isort --check-only app/ tests/ alembic/` (9.0.1, CI's pin)  | ✅ clean                                                                  |
| `python3 scripts/validate_migrations.py --strict`            | ✅ 409 revisions, single head (`f7b3c8d2e569`) — no migration this round  |
| `pytest tests/ -q -k "election or ballot or vote or quorum"` | ✅ 497 passed, 1 skipped (pre-existing `py_vapid` optional dep), 0 failed |
| `pytest tests/test_election_codex_round8.py -q`              | ✅ 3 passed, 0 failed                                                     |
| `pytest tests/ -q` (full backend suite)                      | ✅ 9817 passed, 21 skipped (pre-existing/environmental), 0 failed         |
| `tsc --noEmit` / `eslint .`                                  | not run — no frontend file changed this round                             |

New guard tests: `tests/test_election_codex_round8.py` (new file, 3
tests, `TestMultiCollisionRequiresEligibilityForEveryColludingPosition` —
both bypass directions plus a sanity check against over-rejection).

### ELEC-37 — P1 — `cast_vote_with_token`'s dedup-hash discriminator ignored a ballot item's voting-method override — ✅ FIXED

**What:** `election_service.py:1666-1690` (pre-fix) — `_dedup_discriminator()`
picked the dedup-hash discriminator suffix (`""`, `f"rank:{n}"`, or
`f"cand:{id}"`) purely from `election.voting_method` /
`election.max_votes_per_position`. `submit_ballot_with_token`
(`election_service.py:8109-8110` at the reported commit) already resolves a
ballot item's own override first —
`effective_method = ballot_item.get("voting_method") or election.voting_method`
— because `BallotItemInput.voting_method` lets one item legitimately run
under a different method than the election's own column.
`cast_vote_with_token` (`election_service.py:7722-7726` at the reported
commit) called `_dedup_discriminator(election, candidate_id, vote_rank)`
with no item, so for an item overriding e.g. a `simple_majority` election
to `approval`, the bulk route computed `f"cand:{candidate_id}"` and the
single-vote route computed `""` for the identical logical vote.

**Impact:** `vote_dedup_hash = SHA256(election_id:voter:position:discriminator)`
is the database-level UNIQUE-constraint backstop the code's own comments
cite as catching a double-vote race that bypasses the pre-insert SELECT
(`"SECURITY: Database-level unique constraint on vote_dedup_hash prevents
double-voting even if race condition bypasses application checks"`). Two
tokens for the same voter racing on the same overridden item through the
two different routes hashed to two different values, so the UNIQUE
constraint had nothing to collide against and both inserts could commit —
the exact race the backstop exists to catch.

**Verified reachable:** confirmed by reading both routes' actual
discriminator computation (not the paraphrase) — `submit_ballot_with_token`
resolves the item override inline before dispatching to its
`rankings`/`candidate_ids`/single-choice branches, while
`_dedup_discriminator` had no `item` parameter to resolve one at all.
`BallotItemInput.voting_method` (`schemas/election.py`) is a genuine,
validated per-item override (`VALID_VOTING_METHODS`), not a legacy-only
field.

**Fix:** added `_effective_voting_method(election, item)` (mirroring
`_dedup_position_key`'s precedent for the position component) and gave
`_dedup_discriminator` an optional `item` parameter that resolves through
it; `cast_vote_with_token` now passes its already-resolved `matching_item`.
`max_votes_per_position` has no item-level override in the schema, so it is
still read from the election unconditionally. `item=None` (the default)
preserves prior behavior for `cast_vote` and `cast_proxy_vote`, neither of
which resolves a matching ballot item today — those two authenticated (non-
token) routes don't support per-item voting-method overrides in their
duplicate-check business logic either, which is a separate, pre-existing
gap outside what this finding reported; noted here rather than expanded
into scope this round.

**TOCTOU angle (raised alongside this finding, not a fresh instance):**
Codex also flagged that `get_ballot_by_token` reads the election before
`_lock_token_ballot_for_submission`'s `with_for_update()` lock, so the
duplicate-check SELECT could run against a stale REPEATABLE READ snapshot.
Traced this against `_lock_token_ballot_for_submission`'s own docstring
(already applies the `with_for_update()` + `populate_existing=True` fix
this exact staleness class needs, per the `quorum_service.py` precedent it
cites) and against the duplicate-check SELECT itself
(`election_service.py`, both routes): the SELECT is a plain (non-locking)
read and can indeed still answer from a snapshot older than a just-released
competing lock — but unlike the capacity-check class this repo's own
`CLAUDE.md` documents (pitfall #27, where a stale count IS the entire
enforcement), this pre-check is not the enforcement boundary. InnoDB checks
a UNIQUE index against the latest committed state at INSERT time
regardless of the inserting transaction's REPEATABLE READ snapshot — that
is what makes `vote_dedup_hash`'s constraint a valid backstop at all. A
stale pre-check can at worst let a doomed second INSERT reach the database
before failing with `IntegrityError` (already handled — see both routes'
`except IntegrityError` blocks), trading a friendlier "already voted"
message for a generic one; it does not admit a second row. Not a fresh
instance of the ELEC-17/24 staleness class and not fixed this round —
flagged here so the reasoning is on record rather than re-litigated next
pass.

New regression tests in `tests/test_election_codex_round9.py`
(`TestDedupDiscriminatorHonorsItemVotingMethodOverride`, 4 tests) —
confirmed the module fails to import pre-fix (`_dedup_scoped_item_aliases`,
added for ELEC-38 below, doesn't exist yet) via `git stash`; the two
discriminator-matching tests independently reproduce the pre-fix mismatch
by construction (`_dedup_discriminator` without an `item` argument returns
`""` for this election/item pair, not `"cand:<id>"`).

### ELEC-38 — P2 — The ELEC-34 duplicate-check alias broadening could match a different ballot item's vote when one item's title equals another's id — ✅ FIXED

**What:** `ballot_item_candidate_positions()` matches a legacy item (no
explicit `position` field) by its `title` **or** `id` — necessary so a real
legacy candidate keyed under either convention is still found (see the
function's own docstring; narrowing it outright would silently empty a
legitimate item's candidate list, exactly the regression ELEC-34 avoided
reintroducing). ELEC-34 (round 7) widened both routes' duplicate-vote
pre-check to scan for this full alias set so a prior vote stored under
either alias registers as "already voted on this item." But
`BallotItemInput`'s schema (`schemas/election.py`) enforces only
**unique ids** across an election's ballot items (`unique_item_ids`) —
nothing stops a _different_ item's `title` (or explicit `position`
override) from equaling this item's `id`, or vice versa. On that
collision, the broadened alias set for one item also matches a
completely different item's already-stored vote.

**Impact:** item `{"id": "budget", "title": "Budget Approval"}` voted on
first — stored `Vote.position = "budget"` (its own canonical id, per the
bulk route's write convention). A second, distinct item `{"id":
"officer", "title": "budget"}` in the SAME election (its title happens to
equal the first item's id) is then processed: `ballot_item_candidate_positions()`
for `officer` returns `{"officer", "budget"}`, and the duplicate-check
SELECT (`Vote.position.in_(...)`, autoflushed against the just-created
first vote within the same bulk submission) matches the first item's
vote purely on the string `"budget"` — rejecting a legitimate, entirely
separate vote on `officer` as though the voter had already voted on it.
Reproduced exactly as described through both `submit_ballot_with_token`
(single call covering both items) and `cast_vote_with_token` (two
sequential calls, second one incorrectly blocked).

**Verified reachable:** read the actual duplicate-check query/logic in
both routes and confirmed it matches on alias-string overlap alone, with
no join back to a stored item identity. Checked whether `Vote` (or
`Candidate`) carries enough information to fully disambiguate two items
that collide this way: **it does not** — `Vote` has no `ballot_item_id`
column, only `position` (a string) and `candidate_id`; `Candidate.position`
carries the exact same ambiguity a candidate's own row can't resolve,
since which item a candidate was originally created "for" is not
persisted anywhere once its position string is stored. Full disambiguation
of "which item does this stored candidate/vote row belong to" when two
items collide on an alias would need a schema change (e.g., an explicit
`ballot_item_id` column on `Candidate` and/or `Vote`) — flagged as a
**known limitation**, not fixed this round (see `docs/KNOWN_LIMITATIONS.md`).

That said, the specific bug reported — the duplicate-vote _pre-check_
producing a false-positive rejection — **is** fixable in application logic
alone, because it only needs to decide "would this read as a re-vote,"
where under-matching is safe: a genuine repeat vote on a legacy item is
always dedup-hashed against that item's own canonical id (`_dedup_position_key`
/ the bulk route's canonical `position` value), never its title, so
`vote_dedup_hash`'s UNIQUE constraint still catches an actual duplicate on
that exact item even after a colliding alias is dropped from this
pre-check. Over-matching (this bug) has no such backstop — it fails a
legitimate vote outright — so the fix only had to narrow, never widen.

**Fix:** added `_dedup_scoped_item_aliases(item, all_items)`: returns
`ballot_item_candidate_positions(item)` with a fallback (title) alias
dropped whenever some OTHER item in the same election already claims that
exact string as its own id or explicit `position` override — the item's
own id is never dropped (ids are unique per election, so it can never
collide). Used **only** at the two duplicate-check call sites
(`submit_ballot_with_token`'s `existing_check` query, and
`cast_vote_with_token`'s `position_aliases`) — the broader, unscoped
`ballot_item_candidate_positions()` alias set is deliberately left
untouched everywhere it decides candidate ownership/eligibility (e.g.
`item_candidate_positions` in `submit_ballot_with_token`, still used for
validating `choice`/`candidate_ids`/`rankings` belong to the right item),
since narrowing candidate-ownership matching is exactly the regression the
function's own docstring warns against.

New regression tests in `tests/test_election_codex_round9.py`
(`TestDuplicateCheckDoesNotCollideAcrossDistinctItems`, 3 tests, and
`TestDedupScopedItemAliasesHelper`, 4 unit tests) — confirmed the module
fails to import pre-fix via `git stash` (the helper doesn't exist yet); the
end-to-end tests independently reproduce the exact reported rejection
(`"You have already voted on: budget"` / `"already voted"`) against
pre-fix logic by construction. A sanity test confirms a genuine repeat
vote on the same item is still rejected after the narrowing.

**Completion gate (pass 3, after round 9, ELEC-37/38):**

| Check                                                        | Result                                                                    |
| ------------------------------------------------------------ | ------------------------------------------------------------------------- |
| `flake8 app/ tests/ alembic/`                                | ✅ 0 violations                                                           |
| `black --check app/ tests/ alembic/`                         | ✅ clean                                                                  |
| `isort --check-only app/ tests/ alembic/` (9.0.1, CI's pin)  | ✅ clean                                                                  |
| `python3 scripts/validate_migrations.py --strict`            | ✅ 409 revisions, single head (`f7b3c8d2e569`) — no migration this round  |
| `pytest tests/ -q -k "election or ballot or vote or quorum"` | ✅ 508 passed, 1 skipped (pre-existing `py_vapid` optional dep), 0 failed |
| `pytest tests/test_election_codex_round9.py -q`              | ✅ 11 passed, 0 failed                                                    |
| `pytest tests/ -q` (full backend suite)                      | ✅ 9828 passed, 21 skipped (pre-existing/environmental), 0 failed         |
| `tsc --noEmit` / `eslint .`                                  | not run — no frontend file changed this round                             |

New guard tests: `tests/test_election_codex_round9.py` (new file, 11
tests — 4 for ELEC-37, 3 end-to-end + 4 unit for ELEC-38).

**Known limitation flagged this round:** two ballot items whose alias sets
collide (one item's title equals another's id or explicit position) cannot
be fully disambiguated for candidate/vote _ownership_ purposes without a
schema change — see `docs/KNOWN_LIMITATIONS.md`. The duplicate-vote
false-positive this collision caused is fixed (ELEC-38); a candidate
mis-attribution in this same colliding scenario is not, and was not part
of what was reported this round.

### ELEC-39 — P1 — The bulk route's backward-compatible `choice` UUID form hardcoded a "" dedup discriminator regardless of an item's voting-method override — ✅ FIXED

**What:** ELEC-37 (round 9) made `cast_vote_with_token` resolve the
matched ballot item's `voting_method` override — via
`_dedup_discriminator(..., item=matching_item)` — when picking its
vote_dedup_hash discriminator, so an item overriding e.g. a
`simple_majority` election to `"approval"` hashes `f"cand:{candidate_id}"`
regardless of which route cast the vote. `submit_ballot_with_token`'s
`rankings`/`candidate_ids` branches already resolve `effective_method`
inline and pick a matching discriminator (`f"rank:{rank}"` /
`f"cand:{cid}"`). But the same route's third, backward-compatible form —
a plain candidate UUID in `choice` (also used for the `write_in`/
`approve`/`deny` pseudo-choices) — was never gated to a voting method the
way the other two branches are, and its call to `_create_token_vote(...)`
still hardcoded the discriminator to `""` unconditionally.

**Impact:** for an approval-overridden item, a token voting through
`cast_vote_with_token` for candidate C hashes
`f"cand:{C}"`; the same logical vote submitted through the bulk route's
`choice` form (still accepted — nothing rejects a plain-UUID `choice` for
an approval item) hashed `""`. Two tokens racing the same vote through the
two different routes produced two different `vote_dedup_hash` values, so
the UNIQUE constraint — the documented backstop for exactly this kind of
cross-route race — never saw a collision and both inserts could succeed.

**Fix:** the `choice`-form branch now computes its discriminator the same
way the other two branches do — `self._dedup_discriminator(election,
candidate_id, None, item=ballot_item)` — instead of a literal `""`. For
every voting method other than `approval` (and outside the unrelated
`max_votes_per_position > 1` case `_dedup_discriminator` also already
handles), this still resolves to `""`, so dedup hashes for rows written
under the pre-existing, non-overridden common case are byte-identical to
before this fix.

New regression tests in `tests/test_election_codex_round10.py`
(`TestBulkChoiceFormDiscriminatorHonorsItemVotingMethodOverride`, 2 unit
tests on the discriminator value alone, and
`TestBulkChoiceFormEndToEndDedupHash`, 1 end-to-end test that submits a
real ballot through `submit_ballot_with_token`'s `choice` form and asserts
the **persisted** `Vote.vote_dedup_hash` matches what `cast_vote_with_token`
would compute for the identical logical vote — the unit-level assertions
alone would still pass even if the fix were reverted, since
`_dedup_discriminator` itself was already correct; only exercising the
real bulk code path proves line 8334 actually calls it). Confirmed failing
pre-fix via `git stash`.

**Completion gate (pass 3, after round 10, ELEC-39):**

| Check                                                        | Result                                                                    |
| ------------------------------------------------------------ | ------------------------------------------------------------------------- |
| `flake8 app/ tests/ alembic/`                                | ✅ 0 violations                                                           |
| `black --check app/ tests/ alembic/`                         | ✅ clean                                                                  |
| `isort --check-only app/ tests/ alembic/` (9.0.1, CI's pin)  | ✅ clean                                                                  |
| `python3 scripts/validate_migrations.py --strict`            | ✅ 409 revisions, single head (`f7b3c8d2e569`) — no migration this round  |
| `pytest tests/ -q -k "election or ballot or vote or quorum"` | ✅ 511 passed, 1 skipped (pre-existing `py_vapid` optional dep), 0 failed |
| `pytest tests/test_election_codex_round10.py -q`             | ✅ 3 passed, 0 failed                                                     |
| `pytest tests/ -q` (full backend suite)                      | ✅ 9831 passed, 21 skipped (pre-existing/environmental), 0 failed         |
| `tsc --noEmit` / `eslint .`                                  | not run — no frontend file changed this round                             |

New guard tests: `tests/test_election_codex_round10.py` (new file, 3 tests).

### ELEC-40 — P1 — `_dedup_scoped_item_aliases`'s collision-avoidance can miss a vote genuinely historical to `cast_vote_with_token`'s own title-based write convention — 🚩 FLAGGED (not code-fixed this round)

**What:** Codex's ELEC-38 report (round 9) and this codebase's own reply on
it both reasoned that dropping a colliding fallback alias from the
duplicate-vote _pre-check_ is safe because "a genuine repeat vote is always
dedup-hashed against the item's own canonical id... so the UNIQUE
constraint still catches an actual duplicate on that exact item even after
a colliding alias is excluded from the pre-check." That reasoning has an
unstated assumption: it only holds for votes whose `vote_dedup_hash` was
itself computed under the **current**, id-based convention
(`_dedup_position_key`, ELEC-34/round 7). It does not hold for a vote row
that predates that convention.

`cast_vote_with_token` has never changed what it writes into the `Vote.position`
**column** for a legacy item — that has always been, and still is,
`effective_position` (`candidate.position`, the item's **title** for a
legacy candidate; see `_dedup_position_key`'s own docstring: "This governs
only the dedup hash, never the stored `Vote.position` value itself").
ELEC-34 only changed what feeds the **hash**. So: a vote cast through
`cast_vote_with_token` for a legacy item, at any time — including right
now, not only "historically" in a pre-migration sense, though the sharpest
case is a genuinely pre-ELEC-34 production row whose `vote_dedup_hash` was
computed with the _old_ (title-based) formula — is stored with
`Vote.position == <title>`. If that title collides with a sibling item's
canonical key, `_dedup_scoped_item_aliases()` drops it from the pre-check's
alias set, and:

- The **pre-check** no longer finds that row (by construction — that's the
  point of the narrowing), so it will not reject a second vote on the same
  item with the friendly "you have already voted" message.
- For a genuinely pre-ELEC-34 row specifically, the **UNIQUE constraint**
  does not save it either: its `vote_dedup_hash` was computed against the
  title, not the item's id, so a new vote's id-based hash cannot collide
  with it. (A row written by `cast_vote_with_token` _after_ ELEC-34 does
  still hash against the item's own id like everything else, so the UNIQUE
  constraint remains the backstop for that case — only genuinely
  pre-ELEC-34 rows are exposed to an actual bypassed double vote; more
  recent title-keyed rows lose only the friendly pre-check message, not
  the UNIQUE-constraint backstop.)

**Why not code-fixed this round:** the two candidate fixes both have real
costs and neither is obviously correct without a product decision:

1. Revert `_dedup_scoped_item_aliases()`'s narrowing (go back to the full,
   unscoped alias set for the pre-check) — closes this gap for historical
   title-keyed rows, but reopens ELEC-38's false-positive (a legitimate
   vote on a _different_ item rejected as a duplicate merely because its
   alias string collides). Given the schema cannot disambiguate the two
   items apart from the string itself (see ELEC-38 / `KNOWN_LIMITATIONS.md`),
   there is no way to keep both fixed with a pre-check alone.
2. Backfill-migrate every existing `Vote.vote_dedup_hash` to the current
   id-based formula for legacy items — closes the gap at the source, but
   is exactly the kind of data migration this rotation's own rules (see
   `CLAUDE.md`) say needs an owner decision, not a same-round guess: it
   touches every historical vote row and needs a decision on scope
   (all elections, or only ones with a detected collision), rollback
   plan, and whether re-hashing an already-cast, cryptographically-signed
   vote's dedup component is acceptable for a closed election's audit
   trail.

**Severity in practice:** requires the coincidence of (a) an admin having
configured two ballot items whose alias sets collide in the same election
— already established as rare and unencouraged by the ballot-authoring UI
(ELEC-38) — **and** (b) that same election already having a vote cast
through `cast_vote_with_token` for the colliding item before ELEC-34
landed, **and** (c) a voter holding a second, unused token for that
election. Flagged rather than guessed at; mirrored to
`docs/KNOWN_LIMITATIONS.md`, correcting that entry's prior overstated "the
UNIQUE constraint still catches an actual duplicate" claim to the
narrower, accurate one above.

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
