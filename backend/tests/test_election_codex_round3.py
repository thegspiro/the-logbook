"""
Elections — regression tests for the round-3 Codex review on PR #2162
(pass 3's round-1 fixes reviewed a second time).

Covers the findings confirmed real against current code:

1. (ELEC-22, P1) A ballot item persisted without its own "position" field
   ties its candidates by *title* (a long-standing convention the voting UI
   and `check_voter_eligibility` already rely on — see
   `BallotVotingPage.tsx::getCandidatesForItem`). Round 1's new
   item-eligibility allow-list matched only the item's id, dropping that
   fallback and emptying every legacy candidate-selection ballot item's
   candidate list on `/ballot/lookup`, `cast_vote_with_token`, and
   `submit_ballot_with_token`.

2. (ELEC-23, P1) `cast_vote_with_token`'s new per-item eligibility check
   (round 1, ELEC-21) only fires when a candidate's position resolves to a
   ballot item. A candidate created for a plain `election.positions` entry
   (not tied to any item) falls through untouched whenever the election
   also has ballot items, because `eligible_positions` was never snapshotted
   on the token in that case (`send_ballot_emails` skipped it unconditionally
   whenever `election.ballot_items` was truthy) — authorization failed open
   for exactly the case a restricted position exists to prevent.

Finding 3 (attestation/deletion lock ordering, ELEC-24) is covered by
`TestAttestationLocksElection.test_election_locked_before_batch` in
`test_election_codex_round2.py`, extending the existing class for that
fix rather than duplicating its fixtures here.
"""

import secrets
import uuid
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, patch

import pytest
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.election import VotingToken
from app.services.election_service import (
    ElectionService,
    ballot_item_candidate_positions,
)

pytestmark = [pytest.mark.integration]


def _uid() -> str:
    return str(uuid.uuid4())


# ===================================================================
# Finding 1 (ELEC-22) — a legacy ballot item with no explicit "position"
# field must keep matching candidates by title, not just by id
# ===================================================================


class TestLegacyTitleKeyedCandidatePositions:
    def test_ballot_item_candidate_positions_falls_back_to_title(self):
        """Unit-level: an item with no "position" claims its title and id
        as valid candidate.position values; an item with an explicit
        "position" claims only that."""
        legacy_item = {"id": "item_a", "title": "Assistant Chief"}
        assert ballot_item_candidate_positions(legacy_item) == {
            "Assistant Chief",
            "item_a",
        }

        modern_item = {"id": "item_b", "title": "Board Seat", "position": "Board Seat"}
        assert ballot_item_candidate_positions(modern_item) == {"Board Seat"}

    @pytest.fixture
    async def setup_title_keyed_election(self, db_session: AsyncSession):
        """One OPEN election with a single ballot item persisted with no
        "position" field (the pre-migration/legacy shape) and one accepted
        candidate stored under the item's *title*, not its id."""
        org_id, user_id, election_id, candidate_id = _uid(), _uid(), _uid(), _uid()
        salt = secrets.token_hex(32)
        now = datetime.now(timezone.utc)

        await db_session.execute(
            text(
                "INSERT INTO organizations (id, name, organization_type, slug, timezone) "
                "VALUES (:id, :name, 'fire_department', :slug, 'UTC')"
            ),
            {"id": org_id, "name": "Round3 FD", "slug": f"r3-{org_id[:8]}"},
        )
        await db_session.execute(
            text(
                "INSERT INTO users "
                "(id, organization_id, username, first_name, last_name, "
                "email, password_hash, status) "
                "VALUES (:id, :org, :un, 'Voter', 'Legacy', :em, 'hashed', 'active')"
            ),
            {
                "id": user_id,
                "org": org_id,
                "un": f"r3-voter-{user_id[:8]}",
                "em": f"r3-voter-{user_id[:8]}@test.com",
            },
        )
        # Deliberately no "position" key — the legacy shape this convention
        # exists for.
        ballot_items = (
            '[{"id": "legacy_item", "type": "officer_election", '
            '"title": "Assistant Chief", "eligible_voter_types": ["all"]}]'
        )
        await db_session.execute(
            text(
                "INSERT INTO elections "
                "(id, organization_id, title, election_type, ballot_items, "
                "start_date, end_date, status, anonymous_voting, "
                "allow_write_ins, max_votes_per_position, voting_method, "
                "victory_condition, voter_anonymity_salt, quorum_type, "
                "created_by, email_sent, results_visible_immediately, "
                "enable_runoffs, runoff_type, max_runoff_rounds, "
                "is_runoff, runoff_round, created_at, updated_at) "
                "VALUES (:id, :org, 'Legacy Item Election', 'general', :items, "
                ":start, :end, 'open', 1, 0, 1, 'simple_majority', "
                "'most_votes', :salt, 'none', :creator, 0, 0, 0, 'top_two', 3, "
                "0, 0, NOW(), NOW())"
            ),
            {
                "id": election_id,
                "org": org_id,
                "items": ballot_items,
                "start": now - timedelta(days=1),
                "end": now + timedelta(days=1),
                "salt": salt,
                "creator": user_id,
            },
        )
        # Candidate is keyed to the item's TITLE — the legacy convention.
        await db_session.execute(
            text(
                "INSERT INTO candidates "
                "(id, election_id, name, position, accepted, is_write_in, "
                "display_order, nomination_date, created_at, updated_at) "
                "VALUES (:id, :eid, 'Legacy Candidate', 'Assistant Chief', "
                "1, 0, 0, NOW(), NOW(), NOW())"
            ),
            {"id": candidate_id, "eid": election_id},
        )
        await db_session.flush()
        return {
            "org_id": org_id,
            "user_id": user_id,
            "election_id": election_id,
            "candidate_id": candidate_id,
            "salt": salt,
        }

    async def _issue_token(self, db_session, data, **kwargs):
        svc = ElectionService(db_session)
        token, raw = await svc._generate_voting_token(
            user_id=uuid.UUID(data["user_id"]),
            election_id=uuid.UUID(data["election_id"]),
            organization_id=uuid.UUID(data["org_id"]),
            election_end_date=datetime.now(timezone.utc) + timedelta(days=1),
            anonymity_salt=data["salt"],
            **kwargs,
        )
        await db_session.flush()
        return token, raw

    async def test_lookup_still_returns_title_keyed_candidate(
        self, db_session: AsyncSession, setup_title_keyed_election
    ):
        """/ballot/lookup must not silently empty a legacy item's candidate
        list just because it is scoped by eligible_item_ids."""
        from app.api.v1.endpoints.elections import (
            BallotLookupRequest,
            lookup_ballot_by_token,
        )

        data = setup_title_keyed_election
        _, raw = await self._issue_token(
            db_session, data, eligible_item_ids=["legacy_item"]
        )

        result = await lookup_ballot_by_token(
            payload=BallotLookupRequest(token=raw), db=db_session, _rate=None
        )

        assert (
            len(result.candidates) == 1
        ), "Legacy title-keyed candidate was dropped from an eligible item"
        assert result.candidates[0].id == uuid.UUID(data["candidate_id"])

    async def test_cast_vote_with_token_accepts_title_keyed_candidate(
        self, db_session: AsyncSession, setup_title_keyed_election
    ):
        data = setup_title_keyed_election
        svc = ElectionService(db_session)
        _, raw = await self._issue_token(
            db_session, data, eligible_item_ids=["legacy_item"]
        )

        vote, error = await svc.cast_vote_with_token(
            token=raw,
            candidate_id=uuid.UUID(data["candidate_id"]),
            position=None,
        )

        assert error is None, f"Legacy title-keyed candidate wrongly rejected: {error}"
        assert vote is not None

    async def test_submit_ballot_choice_accepts_title_keyed_candidate(
        self, db_session: AsyncSession, setup_title_keyed_election
    ):
        data = setup_title_keyed_election
        svc = ElectionService(db_session)
        _, raw = await self._issue_token(db_session, data)

        result, error = await svc.submit_ballot_with_token(
            token=raw,
            votes=[
                {
                    "ballot_item_id": "legacy_item",
                    "choice": data["candidate_id"],
                }
            ],
        )

        assert error is None, f"Legacy title-keyed candidate wrongly rejected: {error}"
        assert result["votes_cast"] == 1


# ===================================================================
# Finding 2 (ELEC-23) — a positional candidate not tied to any ballot
# item must still be checked against position eligibility, even when
# the election also has ballot items
# ===================================================================


class TestMixedElectionPositionalCandidateFailsClosed:
    @pytest.fixture
    async def setup_mixed_election(self, db_session: AsyncSession):
        """One OPEN election configuring BOTH a ballot item (open to
        everyone) and a plain position "Secretary" restricted to
        operational members. An administrative member is eligible for the
        item but not for Secretary."""
        org_id = _uid()
        operational_id = _uid()
        admin_id = _uid()
        election_id = _uid()
        item_candidate_id = _uid()
        secretary_candidate_id = _uid()
        salt = secrets.token_hex(32)
        now = datetime.now(timezone.utc)

        await db_session.execute(
            text(
                "INSERT INTO organizations (id, name, organization_type, slug, timezone) "
                "VALUES (:id, :name, 'fire_department', :slug, 'UTC')"
            ),
            {"id": org_id, "name": "Round3 Mixed FD", "slug": f"r3m-{org_id[:8]}"},
        )
        for uid, uname, mtype in [
            (operational_id, "r3opmember", "active"),
            (admin_id, "r3adminmember", "administrative"),
        ]:
            await db_session.execute(
                text(
                    "INSERT INTO users "
                    "(id, organization_id, username, first_name, last_name, "
                    "email, password_hash, status, membership_type) "
                    "VALUES (:id, :org, :un, :fn, 'Member', :em, 'hashed', "
                    "'active', :mt)"
                ),
                {
                    "id": uid,
                    "org": org_id,
                    "un": uname,
                    "fn": uname.title(),
                    "em": f"{uname}@test.com",
                    "mt": mtype,
                },
            )

        ballot_items = (
            '[{"id": "board_seat", "type": "officer_election", '
            '"title": "Board Seat", "position": "board_seat", '
            '"eligible_voter_types": ["all"]}]'
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
                "VALUES (:id, :org, 'Mixed Election', 'general', :positions, "
                ":pos_elig, :items, :start, :end, 'open', 1, 0, 1, "
                "'simple_majority', 'most_votes', :salt, 'none', :creator, "
                "0, 0, 0, 'top_two', 3, 0, 0, NOW(), NOW())"
            ),
            {
                "id": election_id,
                "org": org_id,
                "positions": '["Secretary"]',
                "pos_elig": '{"Secretary": {"voter_types": ["operational"]}}',
                "items": ballot_items,
                "start": now - timedelta(days=1),
                "end": now + timedelta(days=1),
                "salt": salt,
                "creator": operational_id,
            },
        )
        await db_session.execute(
            text(
                "INSERT INTO candidates "
                "(id, election_id, name, position, accepted, is_write_in, "
                "display_order, nomination_date, created_at, updated_at) "
                "VALUES (:id, :eid, 'Board Candidate', 'board_seat', 1, 0, 0, "
                "NOW(), NOW(), NOW())"
            ),
            {"id": item_candidate_id, "eid": election_id},
        )
        # Positional candidate — NOT tied to any ballot item.
        await db_session.execute(
            text(
                "INSERT INTO candidates "
                "(id, election_id, name, position, accepted, is_write_in, "
                "display_order, nomination_date, created_at, updated_at) "
                "VALUES (:id, :eid, 'Secretary Candidate', 'Secretary', 1, 0, "
                "1, NOW(), NOW(), NOW())"
            ),
            {"id": secretary_candidate_id, "eid": election_id},
        )
        await db_session.flush()

        return {
            "org_id": org_id,
            "operational_id": operational_id,
            "admin_id": admin_id,
            "election_id": election_id,
            "item_candidate_id": item_candidate_id,
            "secretary_candidate_id": secretary_candidate_id,
            "salt": salt,
        }

    async def test_token_issuance_snapshots_positions_even_with_ballot_items(
        self, db_session: AsyncSession, setup_mixed_election
    ):
        """Root cause: send_ballot_emails must compute eligible_positions
        from election.position_eligibility even when the election also has
        ballot_items — it previously skipped this unconditionally whenever
        ballot_items was truthy, leaving eligible_positions permanently
        None (unrestricted) for every mixed election."""
        data = setup_mixed_election
        svc = ElectionService(db_session)

        with patch(
            "app.services.email_service.EmailService.send_batch",
            new=AsyncMock(side_effect=lambda batch: [True] * len(batch)),
        ):
            sent, failed, skipped, skipped_details, _sent_ids = (
                await svc.send_ballot_emails(
                    election_id=uuid.UUID(data["election_id"]),
                    organization_id=uuid.UUID(data["org_id"]),
                    recipient_user_ids=[uuid.UUID(data["admin_id"])],
                    base_ballot_url="https://fd.example/ballot",
                )
            )

        assert (
            sent == 1
        ), f"expected the admin to still receive a ballot for the item (failed={failed}, skipped_details={skipped_details})"

        tokens = (
            (
                await db_session.execute(
                    select(VotingToken).where(
                        VotingToken.election_id == data["election_id"]
                    )
                )
            )
            .scalars()
            .all()
        )
        assert len(tokens) == 1
        token = tokens[0]
        assert token.eligible_positions == [], (
            "The administrative recipient is eligible for zero plain "
            "positions (Secretary requires operational) — the snapshot "
            "must reflect that, not stay None/unrestricted."
        )
        assert token.eligible_item_ids == ["board_seat"]

    async def test_cast_vote_with_token_rejects_ineligible_positional_candidate(
        self, db_session: AsyncSession, setup_mixed_election
    ):
        """End-to-end: a token that is eligible for the ballot item but not
        for Secretary must not be able to vote for the Secretary candidate
        just because that candidate doesn't resolve to any ballot item."""
        data = setup_mixed_election
        svc = ElectionService(db_session)
        _, raw = await svc._generate_voting_token(
            user_id=uuid.UUID(data["admin_id"]),
            election_id=uuid.UUID(data["election_id"]),
            organization_id=uuid.UUID(data["org_id"]),
            election_end_date=datetime.now(timezone.utc) + timedelta(days=1),
            anonymity_salt=data["salt"],
            eligible_item_ids=["board_seat"],
            eligible_positions=[],  # this recipient qualifies for no plain position
        )
        await db_session.flush()

        vote, error = await svc.cast_vote_with_token(
            token=raw,
            candidate_id=uuid.UUID(data["secretary_candidate_id"]),
            position="Secretary",
        )

        assert vote is None
        assert error is not None
        assert "not eligible" in error

    async def test_cast_vote_with_token_still_allows_eligible_item_vote(
        self, db_session: AsyncSession, setup_mixed_election
    ):
        """The same token must still be able to vote on the ballot item it
        *is* eligible for — populating eligible_positions must not
        collaterally block item-scoped candidates whose position isn't in
        election.positions."""
        data = setup_mixed_election
        svc = ElectionService(db_session)
        _, raw = await svc._generate_voting_token(
            user_id=uuid.UUID(data["admin_id"]),
            election_id=uuid.UUID(data["election_id"]),
            organization_id=uuid.UUID(data["org_id"]),
            election_end_date=datetime.now(timezone.utc) + timedelta(days=1),
            anonymity_salt=data["salt"],
            eligible_item_ids=["board_seat"],
            eligible_positions=[],
        )
        await db_session.flush()

        vote, error = await svc.cast_vote_with_token(
            token=raw,
            candidate_id=uuid.UUID(data["item_candidate_id"]),
            position=None,
        )

        assert error is None, f"Eligible item vote wrongly rejected: {error}"
        assert vote is not None
