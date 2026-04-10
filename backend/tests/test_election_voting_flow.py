"""
Election Voting Flow — Integration Tests

Tests covering the full vote-casting lifecycle through ElectionService:
  - Setup of org/users/election/candidates via raw SQL
  - Vote casting (success, chain hashing, dedup)
  - Voter eligibility and has_user_voted checks
  - Election results tallying and closing
  - Vote integrity verification and forensics
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


# ── TestElectionSetup ─────────────────────────────────────────────────


class TestElectionSetup:
    """Provides the shared ``setup_election`` fixture used by all test classes."""

    @pytest.fixture
    async def setup_election(self, db_session: AsyncSession):
        """Create org, 3 users, an OPEN election with 2 candidates for 'Chief'."""
        org_id = _uid()
        user1_id = _uid()
        user2_id = _uid()
        user3_id = _uid()
        election_id = _uid()
        candidate_a_id = _uid()
        candidate_b_id = _uid()
        salt = secrets.token_hex(32)

        now = datetime.now(timezone.utc)
        start = now - timedelta(days=1)
        end = now + timedelta(days=1)

        await db_session.execute(
            text(
                "INSERT INTO organizations (id, name, organization_type, slug, timezone) "
                "VALUES (:id, :name, :otype, :slug, :tz)"
            ),
            {
                "id": org_id,
                "name": "Election Test FD",
                "otype": "fire_department",
                "slug": f"elec-{org_id[:8]}",
                "tz": "America/New_York",
            },
        )

        for uid, uname, fn, ln in [
            (user1_id, "voter1", "Alice", "Anderson"),
            (user2_id, "voter2", "Bob", "Baker"),
            (user3_id, "voter3", "Carol", "Clark"),
        ]:
            await db_session.execute(
                text(
                    "INSERT INTO users "
                    "(id, organization_id, username, first_name, last_name, "
                    "email, password_hash, status) "
                    "VALUES (:id, :org, :un, :fn, :ln, :em, :pw, 'active')"
                ),
                {
                    "id": uid,
                    "org": org_id,
                    "un": uname,
                    "fn": fn,
                    "ln": ln,
                    "em": f"{uname}@test.com",
                    "pw": "hashed",
                },
            )

        await db_session.execute(
            text(
                "INSERT INTO elections "
                "(id, organization_id, title, election_type, positions, "
                "start_date, end_date, status, anonymous_voting, "
                "allow_write_ins, max_votes_per_position, voting_method, "
                "victory_condition, voter_anonymity_salt, quorum_type, "
                "created_by) "
                "VALUES (:id, :org, :title, :etype, :positions, "
                ":start, :end, :status, :anon, :write_in, :max_votes, "
                ":method, :victory, :salt, :quorum, :creator)"
            ),
            {
                "id": election_id,
                "org": org_id,
                "title": "Officer Election 2026",
                "etype": "officer",
                "positions": '["Chief"]',
                "start": start,
                "end": end,
                "status": "open",
                "anon": True,
                "write_in": False,
                "max_votes": 1,
                "method": "simple_majority",
                "victory": "most_votes",
                "salt": salt,
                "quorum": "none",
                "creator": user1_id,
            },
        )

        for cid, cuser, cname, order in [
            (candidate_a_id, user1_id, "Alice Anderson", 0),
            (candidate_b_id, user2_id, "Bob Baker", 1),
        ]:
            await db_session.execute(
                text(
                    "INSERT INTO candidates "
                    "(id, election_id, user_id, name, position, "
                    "accepted, is_write_in, display_order) "
                    "VALUES (:id, :eid, :uid, :name, :pos, :acc, :wi, :ord)"
                ),
                {
                    "id": cid,
                    "eid": election_id,
                    "uid": cuser,
                    "name": cname,
                    "pos": "Chief",
                    "acc": True,
                    "wi": False,
                    "ord": order,
                },
            )

        await db_session.flush()

        return {
            "org_id": org_id,
            "user1_id": user1_id,
            "user2_id": user2_id,
            "user3_id": user3_id,
            "election_id": election_id,
            "candidate_a_id": candidate_a_id,
            "candidate_b_id": candidate_b_id,
            "salt": salt,
        }


# ── TestVoteCasting ───────────────────────────────────────────────────


class TestVoteCasting(TestElectionSetup):
    """Core voting flow: cast, chain linking, dedup, and has_user_voted."""

    async def test_cast_vote_success(
        self, db_session: AsyncSession, setup_election
    ):
        data = await setup_election
        svc = ElectionService(db_session)

        vote, err = await svc.cast_vote(
            user_id=uuid.UUID(data["user1_id"]),
            election_id=uuid.UUID(data["election_id"]),
            candidate_id=uuid.UUID(data["candidate_a_id"]),
            position="Chief",
            organization_id=uuid.UUID(data["org_id"]),
            ip_address="127.0.0.1",
            user_agent="test-agent",
        )

        assert err is None, f"Expected success, got error: {err}"
        assert vote is not None
        assert vote.vote_signature is not None
        assert vote.chain_hash is not None
        assert vote.receipt_hash is not None
        assert vote.position == "Chief"

    async def test_cast_vote_creates_chain(
        self, db_session: AsyncSession, setup_election
    ):
        data = await setup_election
        svc = ElectionService(db_session)

        vote1, err1 = await svc.cast_vote(
            user_id=uuid.UUID(data["user1_id"]),
            election_id=uuid.UUID(data["election_id"]),
            candidate_id=uuid.UUID(data["candidate_a_id"]),
            position="Chief",
            organization_id=uuid.UUID(data["org_id"]),
        )
        assert err1 is None

        vote2, err2 = await svc.cast_vote(
            user_id=uuid.UUID(data["user2_id"]),
            election_id=uuid.UUID(data["election_id"]),
            candidate_id=uuid.UUID(data["candidate_b_id"]),
            position="Chief",
            organization_id=uuid.UUID(data["org_id"]),
        )
        assert err2 is None

        assert vote1 is not None
        assert vote2 is not None
        # The second vote's chain_hash must differ from the first --
        # it incorporates the first vote's chain_hash as its predecessor.
        assert vote2.chain_hash != vote1.chain_hash

    async def test_has_user_voted_before_and_after(
        self, db_session: AsyncSession, setup_election
    ):
        data = await setup_election
        svc = ElectionService(db_session)

        # Need the Election ORM object for anonymous-voting hash lookup
        election = await svc.get_election(
            data["election_id"], data["org_id"]
        )

        before = await svc.has_user_voted(
            uuid.UUID(data["user3_id"]),
            uuid.UUID(data["election_id"]),
            election=election,
        )
        assert before is False

        vote, err = await svc.cast_vote(
            user_id=uuid.UUID(data["user3_id"]),
            election_id=uuid.UUID(data["election_id"]),
            candidate_id=uuid.UUID(data["candidate_a_id"]),
            position="Chief",
            organization_id=uuid.UUID(data["org_id"]),
        )
        assert err is None

        # Re-fetch election so the object is current after the commit
        election = await svc.get_election(
            data["election_id"], data["org_id"]
        )
        after = await svc.has_user_voted(
            uuid.UUID(data["user3_id"]),
            uuid.UUID(data["election_id"]),
            election=election,
        )
        assert after is True

    async def test_cannot_vote_twice_same_position(
        self, db_session: AsyncSession, setup_election
    ):
        data = await setup_election
        svc = ElectionService(db_session)

        vote1, err1 = await svc.cast_vote(
            user_id=uuid.UUID(data["user1_id"]),
            election_id=uuid.UUID(data["election_id"]),
            candidate_id=uuid.UUID(data["candidate_a_id"]),
            position="Chief",
            organization_id=uuid.UUID(data["org_id"]),
        )
        assert err1 is None

        vote2, err2 = await svc.cast_vote(
            user_id=uuid.UUID(data["user1_id"]),
            election_id=uuid.UUID(data["election_id"]),
            candidate_id=uuid.UUID(data["candidate_b_id"]),
            position="Chief",
            organization_id=uuid.UUID(data["org_id"]),
        )
        assert vote2 is None
        assert err2 is not None
        assert "already voted" in err2.lower()


# ── TestElectionResults ───────────────────────────────────────────────


class TestElectionResults(TestElectionSetup):
    """Results tallying and election closing."""

    async def test_get_results_after_votes(
        self, db_session: AsyncSession, setup_election
    ):
        """2 votes for candidate A, 1 for candidate B -> A wins."""
        data = await setup_election
        svc = ElectionService(db_session)

        for uid in [data["user1_id"], data["user3_id"]]:
            vote, err = await svc.cast_vote(
                user_id=uuid.UUID(uid),
                election_id=uuid.UUID(data["election_id"]),
                candidate_id=uuid.UUID(data["candidate_a_id"]),
                position="Chief",
                organization_id=uuid.UUID(data["org_id"]),
            )
            assert err is None, f"Vote failed for {uid}: {err}"

        vote_b, err_b = await svc.cast_vote(
            user_id=uuid.UUID(data["user2_id"]),
            election_id=uuid.UUID(data["election_id"]),
            candidate_id=uuid.UUID(data["candidate_b_id"]),
            position="Chief",
            organization_id=uuid.UUID(data["org_id"]),
        )
        assert err_b is None

        # Use _internal_bypass_visibility because the election is still open
        results = await svc.get_election_results(
            uuid.UUID(data["election_id"]),
            uuid.UUID(data["org_id"]),
            _internal_bypass_visibility=True,
        )

        assert results is not None
        assert results.total_votes == 3

        # Candidate A should be the winner
        winner = [r for r in results.overall_results if r.is_winner]
        assert len(winner) >= 1
        winner_ids = [str(w.candidate_id) for w in winner]
        assert data["candidate_a_id"] in winner_ids

    async def test_close_election_finalizes(
        self, db_session: AsyncSession, setup_election
    ):
        data = await setup_election
        svc = ElectionService(db_session)

        vote, err = await svc.cast_vote(
            user_id=uuid.UUID(data["user1_id"]),
            election_id=uuid.UUID(data["election_id"]),
            candidate_id=uuid.UUID(data["candidate_a_id"]),
            position="Chief",
            organization_id=uuid.UUID(data["org_id"]),
        )
        assert err is None

        closed, close_err = await svc.close_election(
            uuid.UUID(data["election_id"]),
            uuid.UUID(data["org_id"]),
        )

        assert close_err is None
        assert closed is not None
        assert closed.status.value == "closed"


# ── TestVoteIntegrity ─────────────────────────────────────────────────


class TestVoteIntegrity(TestElectionSetup):
    """Cryptographic integrity and forensic report checks."""

    async def test_verify_vote_integrity(
        self, db_session: AsyncSession, setup_election
    ):
        data = await setup_election
        svc = ElectionService(db_session)

        vote, err = await svc.cast_vote(
            user_id=uuid.UUID(data["user1_id"]),
            election_id=uuid.UUID(data["election_id"]),
            candidate_id=uuid.UUID(data["candidate_a_id"]),
            position="Chief",
            organization_id=uuid.UUID(data["org_id"]),
        )
        assert err is None

        integrity = await svc.verify_vote_integrity(
            uuid.UUID(data["election_id"]),
            uuid.UUID(data["org_id"]),
        )

        assert integrity["integrity_status"] == "PASS"
        assert integrity["total_votes"] == 1
        assert integrity["valid_signatures"] == 1
        assert integrity["tampered_votes"] == 0
        assert integrity["chain_verified"] is True

    async def test_vote_forensics(
        self, db_session: AsyncSession, setup_election
    ):
        data = await setup_election
        svc = ElectionService(db_session)

        for uid, cid in [
            (data["user1_id"], data["candidate_a_id"]),
            (data["user2_id"], data["candidate_b_id"]),
            (data["user3_id"], data["candidate_a_id"]),
        ]:
            vote, err = await svc.cast_vote(
                user_id=uuid.UUID(uid),
                election_id=uuid.UUID(data["election_id"]),
                candidate_id=uuid.UUID(cid),
                position="Chief",
                organization_id=uuid.UUID(data["org_id"]),
            )
            assert err is None, f"Vote failed for {uid}: {err}"

        forensics = await svc.get_election_forensics(
            uuid.UUID(data["election_id"]),
            uuid.UUID(data["org_id"]),
        )

        assert forensics is not None
        assert forensics["election_id"] == data["election_id"]
        assert forensics["vote_integrity"]["integrity_status"] == "PASS"
        assert forensics["vote_integrity"]["chain_verified"] is True
        assert forensics["vote_integrity"]["total_votes"] == 3
