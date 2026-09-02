"""
Elections — regression test for the round-5 Codex review on PR #2162.

Covers the one finding posted against commit 53c81b92a (the state before
round 4 — round 4 did not touch this code, so it was still open):

(ELEC-29, P1) `cast_vote_with_token` and the `/ballot/lookup` endpoint both
classify a candidate as "item-scoped" the moment its position resolves to
*any* ballot item (`ballot_item_candidate_positions`), via a `next(...)`
first-match lookup. Nothing in schema validation (`ElectionBase`/
`ElectionUpdate` in `app/schemas/election.py`) stops a plain
`election.positions` entry from equaling a ballot item's explicit
`position`, `title`, or legacy id — so a candidate's position can
legitimately belong to *both* namespaces at once. When it does, the old
code treated it as item-scoped only and never checked
`voting_token.eligible_positions` at all, even though the token may be
restricted on that plain position.

Concrete scenario: a restricted plain position "Secretary" (governed by
`position_eligibility`, so `eligible_positions` matters) plus an
*unrestricted* legacy ballot item also titled "Secretary" (no explicit
"position" field, so `ballot_item_candidate_positions` falls back to its
title — the ELEC-22 convention). `send_ballot_emails` computes
`eligible_item_ids` and `eligible_positions` independently (item
eligibility depends on the item's own `eligible_voter_types`; position
eligibility depends on `position_eligibility`), so a recipient who
qualifies for the unrestricted item but NOT for the restricted position
gets a token with `eligible_item_ids` containing that item and
`eligible_positions` = [] (empty, not None — recipient fails the position's
voter-type rule). Pre-fix, that token could vote for the "Secretary"
candidate anyway, because the `next()` lookup matched the item first and
the `matching_item is not None` branch never consults
`eligible_positions`.

Fixed by detecting the collision directly (`effective_position in
election.positions`) at both call sites and requiring the candidate to
clear *both* applicable checks when it belongs to both namespaces, rather
than trusting whichever one an iteration order resolved first.
"""

import secrets
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.election_service import ElectionService

pytestmark = [pytest.mark.integration]


def _uid() -> str:
    return str(uuid.uuid4())


class TestCollidingPositionAndBallotItemRequireBothEligibility:
    @pytest.fixture
    async def setup_colliding_election(self, db_session: AsyncSession):
        """One OPEN election with:

        - a plain position "Secretary" restricted to administrative members
          via `position_eligibility`
        - an UNRESTRICTED legacy ballot item titled "Secretary" (no
          explicit "position" field, so it claims "Secretary" via the
          title fallback — colliding with the plain position of the same
          name)
        - a single candidate running for position "Secretary", which is
          therefore claimed by BOTH namespaces at once

        Nothing in schema validation prevents this configuration — see
        ELEC-29.
        """
        org_id = _uid()
        voter_id = _uid()
        election_id = _uid()
        candidate_id = _uid()
        salt = secrets.token_hex(32)
        now = datetime.now(timezone.utc)

        await db_session.execute(
            text(
                "INSERT INTO organizations (id, name, organization_type, slug, timezone) "
                "VALUES (:id, :name, 'fire_department', :slug, 'UTC')"
            ),
            {"id": org_id, "name": "Round5 Collision FD", "slug": f"r5-{org_id[:8]}"},
        )
        # An operational (not administrative) member — fails the plain
        # Secretary position's voter-type rule, but qualifies for the
        # unrestricted legacy item (eligible_voter_types: ["all"]).
        await db_session.execute(
            text(
                "INSERT INTO users "
                "(id, organization_id, username, first_name, last_name, "
                "email, password_hash, status, membership_type) "
                "VALUES (:id, :org, :un, 'Operational', 'Voter', :em, "
                "'hashed', 'active', 'operational')"
            ),
            {
                "id": voter_id,
                "org": org_id,
                "un": f"r5-voter-{voter_id[:8]}",
                "em": f"r5-voter-{voter_id[:8]}@test.com",
            },
        )
        # Deliberately no "position" key on the ballot item — the legacy
        # shape whose title fallback (ballot_item_candidate_positions)
        # collides with the plain "Secretary" position below.
        ballot_items = (
            '[{"id": "legacy_secretary", "type": "officer_election", '
            '"title": "Secretary", "eligible_voter_types": ["all"]}]'
        )
        await db_session.execute(
            text(
                "INSERT INTO elections "
                "(id, organization_id, title, election_type, positions, "
                "position_eligibility, ballot_items, start_date, end_date, "
                "status, anonymous_voting, allow_write_ins, "
                "max_votes_per_position, voting_method, victory_condition, "
                "voter_anonymity_salt, quorum_type, created_by, email_sent, "
                "results_visible_immediately, enable_runoffs, runoff_type, "
                "max_runoff_rounds, is_runoff, runoff_round, created_at, "
                "updated_at) "
                "VALUES (:id, :org, 'Round5 Collision Election', 'general', "
                ":positions, :pos_elig, :items, :start, :end, 'open', 1, 0, "
                "1, 'simple_majority', 'most_votes', :salt, 'none', "
                ":creator, 0, 0, 0, 'top_two', 3, 0, 0, NOW(), NOW())"
            ),
            {
                "id": election_id,
                "org": org_id,
                "positions": '["Secretary"]',
                "pos_elig": '{"Secretary": {"voter_types": ["administrative"]}}',
                "items": ballot_items,
                "start": now - timedelta(days=1),
                "end": now + timedelta(days=1),
                "salt": salt,
                "creator": voter_id,
            },
        )
        # This single candidate is claimed by BOTH the plain "Secretary"
        # position and the colliding legacy item's title fallback.
        await db_session.execute(
            text(
                "INSERT INTO candidates "
                "(id, election_id, name, position, accepted, is_write_in, "
                "display_order, nomination_date, created_at, updated_at) "
                "VALUES (:id, :eid, 'Secretary Candidate', 'Secretary', 1, "
                "0, 0, NOW(), NOW(), NOW())"
            ),
            {"id": candidate_id, "eid": election_id},
        )
        await db_session.flush()

        return {
            "org_id": org_id,
            "voter_id": voter_id,
            "election_id": election_id,
            "candidate_id": candidate_id,
            "salt": salt,
        }

    async def _issue_mismatched_token(self, db_session, data):
        """A token eligible for the unrestricted legacy item but NOT for
        the restricted plain "Secretary" position — the exact shape
        `send_ballot_emails` produces for an operational recipient in this
        fixture's election."""
        svc = ElectionService(db_session)
        token, raw = await svc._generate_voting_token(
            user_id=uuid.UUID(data["voter_id"]),
            election_id=uuid.UUID(data["election_id"]),
            organization_id=uuid.UUID(data["org_id"]),
            election_end_date=datetime.now(timezone.utc) + timedelta(days=1),
            anonymity_salt=data["salt"],
            eligible_item_ids=["legacy_secretary"],
            eligible_positions=[],
        )
        await db_session.flush()
        return token, raw

    async def test_cast_vote_with_token_rejects_colliding_candidate(
        self, db_session: AsyncSession, setup_colliding_election
    ):
        """Root cause: `cast_vote_with_token` classified this candidate as
        item-scoped only (the `next()` lookup matched the colliding item
        first) and never consulted `eligible_positions`, which is empty
        for this token. Must now be rejected."""
        data = setup_colliding_election
        svc = ElectionService(db_session)
        _token, raw = await self._issue_mismatched_token(db_session, data)

        vote, error = await svc.cast_vote_with_token(
            token=raw,
            candidate_id=uuid.UUID(data["candidate_id"]),
            position=None,
        )

        assert vote is None, (
            "A token ineligible for the restricted plain 'Secretary' "
            "position must not be able to cast this vote merely because "
            "it is eligible for a same-named, unrestricted ballot item "
            f"(ELEC-29); got vote={vote!r}"
        )
        assert error is not None
        assert "not eligible" in error

    async def test_ballot_lookup_hides_colliding_candidate(
        self, db_session: AsyncSession, setup_colliding_election
    ):
        """Same collision, checked at the `/ballot/lookup` endpoint: the
        candidate must not be handed back to a token that is ineligible
        for the plain position it also matches."""
        from app.api.v1.endpoints.elections import (
            BallotLookupRequest,
            lookup_ballot_by_token,
        )

        data = setup_colliding_election
        _token, raw = await self._issue_mismatched_token(db_session, data)

        result = await lookup_ballot_by_token(
            payload=BallotLookupRequest(token=raw), db=db_session, _rate=None
        )

        assert result.candidates == [], (
            "The colliding 'Secretary' candidate must be hidden from a "
            "token ineligible for the plain position, even though the "
            f"same-named ballot item is unrestricted; got {result.candidates!r}"
        )

    async def test_eligible_token_can_still_vote_when_both_scopes_allow(
        self, db_session: AsyncSession, setup_colliding_election
    ):
        """Sanity check: the fix must not over-reject. A token eligible
        under BOTH the item and the plain position must still be able to
        vote and see the candidate."""
        data = setup_colliding_election
        svc = ElectionService(db_session)
        token, raw = await svc._generate_voting_token(
            user_id=uuid.UUID(data["voter_id"]),
            election_id=uuid.UUID(data["election_id"]),
            organization_id=uuid.UUID(data["org_id"]),
            election_end_date=datetime.now(timezone.utc) + timedelta(days=1),
            anonymity_salt=data["salt"],
            eligible_item_ids=["legacy_secretary"],
            eligible_positions=["Secretary"],
        )
        await db_session.flush()

        from app.api.v1.endpoints.elections import (
            BallotLookupRequest,
            lookup_ballot_by_token,
        )

        result = await lookup_ballot_by_token(
            payload=BallotLookupRequest(token=raw), db=db_session, _rate=None
        )
        assert len(result.candidates) == 1
        assert result.candidates[0].id == uuid.UUID(data["candidate_id"])

        vote, error = await svc.cast_vote_with_token(
            token=raw,
            candidate_id=uuid.UUID(data["candidate_id"]),
            position=None,
        )
        assert error is None, f"Fully-eligible token wrongly rejected: {error}"
        assert vote is not None
