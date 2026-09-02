"""
Elections — regression tests for the round-9 Codex review on PR #2173.

PR #2173 (rounds 7-8's follow-up) fixed two prior gaps in the shared
vote-deduplication mechanism (ELEC-34, ELEC-36). Codex posted two more
findings against an earlier commit in this same PR (8a989764c), both about
remaining gaps in that same mechanism:

(ELEC-37, P1) When a legacy ballot item (no explicit "position" field)
overrides the election-level voting method — e.g. a ``simple_majority``
election with an item configured ``approval`` — the vote_dedup_hash
discriminator still differed between the two vote-submission routes:
``submit_ballot_with_token`` already resolves ``ballot_item.get(
"voting_method") or election.voting_method`` to decide which discriminator
form to use, but ``cast_vote_with_token``'s ``_dedup_discriminator`` helper
read ``election.voting_method`` directly, ignoring any item-level override
entirely. Two tokens racing on the same overridden item through the two
different routes could therefore hash to two different values, and the
UNIQUE constraint on ``vote_dedup_hash`` — the documented backstop for
exactly this kind of race — could no longer catch the collision.

Fixed by adding ``_effective_voting_method(election, item)`` (mirroring
``_dedup_position_key`` for the position component) and threading the
matched ballot item through ``_dedup_discriminator`` so both routes derive
the SAME effective method before picking a discriminator form.

(ELEC-38, P2) ``ballot_item_candidate_positions()``'s title/id fallback for
a legacy item is deliberately broad — matching a candidate/vote by either
alias, since a real legacy candidate can be stored under either — but the
schema enforces only unique item **ids**, not uniqueness of one item's
title against a *different* item's id. When one item's title equals
another item's id, the duplicate-vote pre-check for the second item
matched the FIRST item's already-recorded vote purely because the alias
strings collide, and rejected a legitimate vote on a completely different,
unvoted contest.

Fixed by ``_dedup_scoped_item_aliases()``: for duplicate-vote detection
only (never for deciding which candidates legitimately belong to an item —
narrowing there would silently empty a legacy item's candidate list, the
exact regression ``ballot_item_candidate_positions``'s own docstring warns
against), drop a legacy item's title/id fallback alias whenever some OTHER
ballot item in the same election already claims that exact string as its
own id or explicit position override. Under-matching in the duplicate
*pre-check* is safe: new votes for a legacy item are always hashed against
the item's own canonical id (``_dedup_position_key`` / the bulk route's
canonical ``position`` value), never its title, so the database's
``vote_dedup_hash`` UNIQUE constraint still catches a genuine repeat vote
on that item even when a colliding alias was dropped from the pre-check.
"""

import json
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.election_service import (
    ElectionService,
    _dedup_position_key,
    _dedup_scoped_item_aliases,
    _effective_voting_method,
)

pytestmark = [pytest.mark.integration]


def _uid() -> str:
    return str(uuid.uuid4())


async def _make_org(db_session: AsyncSession, *, name: str) -> str:
    org_id = _uid()
    await db_session.execute(
        text(
            "INSERT INTO organizations "
            "(id, name, organization_type, slug, timezone, settings) "
            "VALUES (:id, :name, 'fire_department', :slug, 'UTC', :settings)"
        ),
        {
            "id": org_id,
            "name": name,
            "slug": f"r9-{org_id[:8]}",
            "settings": None,
        },
    )
    return org_id


async def _make_user(db_session: AsyncSession, org_id: str, *, name: str) -> str:
    user_id = _uid()
    await db_session.execute(
        text(
            "INSERT INTO users "
            "(id, organization_id, username, first_name, last_name, "
            "email, password_hash, status, membership_type) "
            "VALUES (:id, :org, :un, 'Round9', :ln, :em, 'hashed', "
            "'active', 'operational')"
        ),
        {
            "id": user_id,
            "org": org_id,
            "un": f"r9-{user_id[:8]}",
            "ln": name,
            "em": f"r9-{user_id[:8]}@test.com",
        },
    )
    return user_id


# ===================================================================
# Finding 1 (ELEC-37) — the dedup-hash discriminator must resolve an
# item-level voting_method override the same way in both routes
# ===================================================================


class TestDedupDiscriminatorHonorsItemVotingMethodOverride:
    """Unit-level, defense-in-depth tests mirroring round 7's
    ``test_dedup_hashes_match_across_routes_for_a_legacy_item`` — these
    prove the actual hash INPUTS collide for the same logical vote, which
    is what the UNIQUE constraint needs regardless of whether a given race
    also happens to be caught by the pre-insert SELECT.
    """

    def test_effective_voting_method_prefers_the_item_override(self):
        election = SimpleNamespace(voting_method="simple_majority")
        item = {"id": "budget", "title": "Budget", "voting_method": "approval"}

        assert _effective_voting_method(election, item) == "approval"
        # No override on the item -> falls back to the election's method.
        assert (
            _effective_voting_method(election, {"id": "budget", "title": "Budget"})
            == "simple_majority"
        )
        # No item at all (plain positional candidate) -> election's method.
        assert _effective_voting_method(election, None) == "simple_majority"

    def test_discriminator_matches_bulk_routes_cand_prefix_for_an_approval_override(
        self,
    ):
        """``submit_ballot_with_token`` computes ``f"cand:{cid}"`` inline
        for its ``candidate_ids`` branch whenever the item's effective
        method is approval (or max_votes>1). ``cast_vote_with_token``'s
        discriminator must match it for the identical item/candidate."""
        election = SimpleNamespace(
            voting_method="simple_majority", max_votes_per_position=1
        )
        item = {"id": "budget", "title": "Budget Approval", "voting_method": "approval"}
        candidate_id = "22222222-2222-2222-2222-222222222222"

        bulk_discriminator = f"cand:{candidate_id}"
        single_discriminator = ElectionService._dedup_discriminator(
            election, candidate_id, None, item=item
        )

        assert single_discriminator == bulk_discriminator, (
            "cast_vote_with_token must resolve the ballot item's "
            "voting_method override, not the election's own "
            f"simple_majority column, when picking the dedup-hash "
            f"discriminator (ELEC-37); got {single_discriminator!r} != "
            f"{bulk_discriminator!r}"
        )

    def test_discriminator_matches_bulk_routes_rank_prefix_for_a_ranked_override(self):
        election = SimpleNamespace(
            voting_method="simple_majority", max_votes_per_position=1
        )
        item = {"id": "board", "title": "Board Seats", "voting_method": "ranked_choice"}

        bulk_discriminator = "rank:1"
        single_discriminator = ElectionService._dedup_discriminator(
            election, "cand-1", 1, item=item
        )

        assert single_discriminator == bulk_discriminator

    def test_full_vote_dedup_hash_matches_across_routes_for_an_overridden_item(self):
        """End-to-end on the hash itself: reproduce each route's actual
        vote_dedup_hash inputs for the same logical vote (same election,
        voter, item, candidate) and confirm they collide, so the UNIQUE
        constraint on vote_dedup_hash functions as the documented backstop
        against a genuine race between the two routes."""
        election = SimpleNamespace(
            voting_method="simple_majority", max_votes_per_position=1
        )
        item = {"id": "budget", "title": "Budget Approval", "voting_method": "approval"}
        election_id = "11111111-1111-1111-1111-111111111111"
        voter_hash = "voterhash"
        candidate_id = "22222222-2222-2222-2222-222222222222"

        # Bulk route (submit_ballot_with_token._create_token_vote): position
        # is always the item's canonical value; the candidate_ids branch
        # always uses "cand:<id>".
        bulk_position = item.get("position") or item["id"]
        bulk_hash = ElectionService._compute_vote_dedup_hash(
            election_id, voter_hash, bulk_position, discriminator=f"cand:{candidate_id}"
        )

        # Single-vote route (cast_vote_with_token): resolves matching_item,
        # then feeds _dedup_position_key + the item-aware discriminator. A
        # legacy candidate keyed by the item's title is the historical
        # single-vote-route convention (see ballot_item_candidate_positions).
        effective_position = item["title"]
        single_position = _dedup_position_key(item, effective_position)
        single_discriminator = ElectionService._dedup_discriminator(
            election, candidate_id, None, item=item
        )
        single_hash = ElectionService._compute_vote_dedup_hash(
            election_id, voter_hash, single_position, discriminator=single_discriminator
        )

        assert single_hash == bulk_hash, (
            "Both routes must hash to the SAME vote_dedup_hash for this "
            "logical vote so a race between them is caught by the UNIQUE "
            f"constraint (ELEC-37); bulk={bulk_hash!r} single={single_hash!r}"
        )


# ===================================================================
# Finding 2 (ELEC-38) — the duplicate-vote pre-check must not treat two
# distinct ballot items as the same contest merely because one item's
# title equals a different item's id
# ===================================================================


class TestDuplicateCheckDoesNotCollideAcrossDistinctItems:
    """One item ``{"id": "budget", "title": "Budget Approval"}`` and a
    second, genuinely different item ``{"id": "officer", "title":
    "budget"}`` — the second item's title collides with the first item's
    id. Both are legitimate, independently votable contests."""

    @pytest.fixture
    async def setup_colliding_alias_election(self, db_session: AsyncSession):
        org_id = await _make_org(db_session, name="Round9 Alias Collision FD")
        voter_id = await _make_user(db_session, org_id, name="Voter")
        election_id = _uid()
        officer_candidate_id = _uid()
        salt = secrets.token_hex(32)
        now = datetime.now(timezone.utc)

        ballot_items = json.dumps(
            [
                {
                    "id": "budget",
                    "type": "membership_approval",
                    "title": "Budget Approval",
                    "eligible_voter_types": ["all"],
                },
                {
                    "id": "officer",
                    "type": "officer_election",
                    "title": "budget",
                    "vote_type": "candidate_selection",
                    "eligible_voter_types": ["all"],
                },
            ]
        )
        await db_session.execute(
            text(
                "INSERT INTO elections "
                "(id, organization_id, title, election_type, positions, "
                "ballot_items, start_date, end_date, "
                "status, anonymous_voting, allow_write_ins, "
                "max_votes_per_position, voting_method, victory_condition, "
                "voter_anonymity_salt, quorum_type, created_by, email_sent, "
                "results_visible_immediately, enable_runoffs, runoff_type, "
                "max_runoff_rounds, is_runoff, runoff_round, created_at, "
                "updated_at) "
                "VALUES (:id, :org, 'Round9 Alias Collision Election', "
                "'general', :positions, :items, :start, :end, 'open', 1, 0, "
                "1, 'simple_majority', 'most_votes', :salt, 'none', "
                ":creator, 0, 0, 0, 'top_two', 3, 0, 0, NOW(), NOW())"
            ),
            {
                "id": election_id,
                "org": org_id,
                "positions": json.dumps([]),
                "items": ballot_items,
                "start": now - timedelta(days=1),
                "end": now + timedelta(days=1),
                "salt": salt,
                "creator": voter_id,
            },
        )
        # A real candidate for the "officer" item, keyed under its own
        # canonical id — the current write-path convention.
        await db_session.execute(
            text(
                "INSERT INTO candidates "
                "(id, election_id, name, position, accepted, is_write_in, "
                "display_order, nomination_date, created_at, updated_at) "
                "VALUES (:id, :eid, 'Officer Candidate', 'officer', "
                "1, 0, 0, NOW(), NOW(), NOW())"
            ),
            {"id": officer_candidate_id, "eid": election_id},
        )
        await db_session.flush()

        return {
            "org_id": org_id,
            "voter_id": voter_id,
            "election_id": election_id,
            "officer_candidate_id": officer_candidate_id,
            "salt": salt,
        }

    async def _issue_token(self, svc, db_session, data):
        _token, raw = await svc._generate_voting_token(
            user_id=uuid.UUID(data["voter_id"]),
            election_id=uuid.UUID(data["election_id"]),
            organization_id=uuid.UUID(data["org_id"]),
            election_end_date=datetime.now(timezone.utc) + timedelta(days=1),
            anonymity_salt=data["salt"],
            eligible_item_ids=["budget", "officer"],
            eligible_positions=None,
        )
        await db_session.flush()
        return raw

    async def test_bulk_submission_covering_both_items_succeeds(
        self, db_session: AsyncSession, setup_colliding_alias_election
    ):
        """The core reported scenario: one bulk submission voting on BOTH
        items must not have its second (officer) vote rejected as a
        duplicate of the first (budget) vote."""
        data = setup_colliding_alias_election
        svc = ElectionService(db_session)
        raw = await self._issue_token(svc, db_session, data)

        result, error = await svc.submit_ballot_with_token(
            token=raw,
            votes=[
                {"ballot_item_id": "budget", "choice": "approve"},
                {
                    "ballot_item_id": "officer",
                    "choice": data["officer_candidate_id"],
                },
            ],
        )

        assert error is None, (
            "A legitimate vote on the 'officer' item must not be rejected "
            "as a duplicate merely because its title ('budget') collides "
            f"with a different item's id (ELEC-38); got error={error!r}"
        )
        assert result is not None
        assert result["votes_cast"] == 2
        assert result["abstentions"] == 0

    async def test_single_vote_route_is_not_blocked_by_a_different_items_vote(
        self, db_session: AsyncSession, setup_colliding_alias_election
    ):
        """Same collision, exercised through cast_vote_with_token: a prior
        vote recorded for the 'budget' item must not count as 'already
        voted' for the 'officer' item just because 'officer's legacy title
        alias happens to be the string 'budget'."""
        data = setup_colliding_alias_election
        svc = ElectionService(db_session)

        raw_1 = await self._issue_token(svc, db_session, data)
        result, error = await svc.submit_ballot_with_token(
            token=raw_1, votes=[{"ballot_item_id": "budget", "choice": "approve"}]
        )
        assert error is None, f"Setup vote on 'budget' unexpectedly rejected: {error}"
        assert result is not None

        raw_2 = await self._issue_token(svc, db_session, data)
        vote, error2 = await svc.cast_vote_with_token(
            token=raw_2,
            candidate_id=uuid.UUID(data["officer_candidate_id"]),
            position=None,
        )

        assert error2 is None, (
            "A legitimate vote for the 'officer' candidate must not be "
            "rejected because a different item's already-recorded vote "
            f"happens to share an alias string (ELEC-38); got "
            f"error={error2!r}"
        )
        assert vote is not None

    async def test_second_bulk_submission_still_rejects_a_genuine_repeat(
        self, db_session: AsyncSession, setup_colliding_alias_election
    ):
        """Sanity check: narrowing the 'officer' item's alias set (dropping
        its colliding 'budget' title alias) must not also break real
        duplicate detection for the item's own canonical id."""
        data = setup_colliding_alias_election
        svc = ElectionService(db_session)

        raw_1 = await self._issue_token(svc, db_session, data)
        result, error = await svc.submit_ballot_with_token(
            token=raw_1,
            votes=[
                {
                    "ballot_item_id": "officer",
                    "choice": data["officer_candidate_id"],
                }
            ],
        )
        assert error is None, f"First vote on 'officer' unexpectedly rejected: {error}"
        assert result is not None

        raw_2 = await self._issue_token(svc, db_session, data)
        result2, error2 = await svc.submit_ballot_with_token(
            token=raw_2,
            votes=[
                {
                    "ballot_item_id": "officer",
                    "choice": data["officer_candidate_id"],
                }
            ],
        )

        assert result2 is None, (
            "A second, genuine repeat vote on 'officer' must still be "
            f"rejected; got result={result2!r}"
        )
        assert error2 is not None
        assert "already voted" in error2


class TestDedupScopedItemAliasesHelper:
    """Unit tests for ``_dedup_scoped_item_aliases`` in isolation."""

    def test_drops_only_the_colliding_fallback_alias(self):
        budget_item = {"id": "budget", "title": "Budget Approval"}
        officer_item = {"id": "officer", "title": "budget"}
        all_items = [budget_item, officer_item]

        assert _dedup_scoped_item_aliases(officer_item, all_items) == {"officer"}
        # The item that legitimately owns "budget" as its own id keeps both
        # of its own aliases untouched.
        assert _dedup_scoped_item_aliases(budget_item, all_items) == {
            "budget",
            "Budget Approval",
        }

    def test_no_collision_leaves_aliases_untouched(self):
        item_a = {"id": "a", "title": "Item A"}
        item_b = {"id": "b", "title": "Item B"}
        all_items = [item_a, item_b]

        assert _dedup_scoped_item_aliases(item_a, all_items) == {"a", "Item A"}
        assert _dedup_scoped_item_aliases(item_b, all_items) == {"b", "Item B"}

    def test_an_items_own_id_is_never_dropped(self):
        # Pathological but schema-legal: two items both claim, via fallback
        # aliases only, strings that cross-collide in both directions is
        # impossible (ids are unique), but a title can equal ANOTHER item's
        # id while that other item's title is unrelated.
        item = {"id": "x", "title": "y"}
        other = {"id": "x-collides-with-nothing", "title": "z"}
        assert "x" in _dedup_scoped_item_aliases(item, [item, other])

    def test_item_with_explicit_position_is_never_narrowed(self):
        item = {"id": "x", "title": "y", "position": "President"}
        other = {"id": "President", "title": "unrelated"}
        # Explicit position is this item's one, unambiguous alias — the
        # collision-narrowing logic only applies to the id/title fallback.
        assert _dedup_scoped_item_aliases(item, [item, other]) == {"President"}
