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

    async def test_cast_vote_success(self, db_session: AsyncSession, setup_election):
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
        election = await svc.get_election(data["election_id"], data["org_id"])

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
        election = await svc.get_election(data["election_id"], data["org_id"])
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

    async def test_vote_forensics(self, db_session: AsyncSession, setup_election):
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


# ── TestMultiVoteMethods (ELEC-3) ─────────────────────────────────────


class TestMultiVoteMethods(TestElectionSetup):
    """Approval and ranked-choice elections legitimately record several
    votes per voter; the dedup hash and app checks must allow them while
    still rejecting true duplicates (module-audit ELEC-3)."""

    async def _set_method(self, db_session, election_id: str, method: str):
        from sqlalchemy import text

        await db_session.execute(
            text("UPDATE elections SET voting_method = :m WHERE id = :id"),
            {"m": method, "id": election_id},
        )
        await db_session.flush()

    async def test_approval_two_candidates_same_position(
        self, db_session: AsyncSession, setup_election
    ):
        data = await setup_election
        await self._set_method(db_session, data["election_id"], "approval")
        svc = ElectionService(db_session)

        for cid in [data["candidate_a_id"], data["candidate_b_id"]]:
            vote, err = await svc.cast_vote(
                user_id=uuid.UUID(data["user1_id"]),
                election_id=uuid.UUID(data["election_id"]),
                candidate_id=uuid.UUID(cid),
                position="Chief",
                organization_id=uuid.UUID(data["org_id"]),
            )
            assert err is None, f"Approval vote for {cid} failed: {err}"
            assert vote is not None

    async def test_approval_duplicate_candidate_rejected(
        self, db_session: AsyncSession, setup_election
    ):
        data = await setup_election
        await self._set_method(db_session, data["election_id"], "approval")
        svc = ElectionService(db_session)

        _, err1 = await svc.cast_vote(
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
            candidate_id=uuid.UUID(data["candidate_a_id"]),
            position="Chief",
            organization_id=uuid.UUID(data["org_id"]),
        )
        assert vote2 is None
        assert err2 is not None

    async def test_ranked_choice_multiple_ranks(
        self, db_session: AsyncSession, setup_election
    ):
        data = await setup_election
        await self._set_method(db_session, data["election_id"], "ranked_choice")
        svc = ElectionService(db_session)

        for rank, cid in [
            (1, data["candidate_a_id"]),
            (2, data["candidate_b_id"]),
        ]:
            vote, err = await svc.cast_vote(
                user_id=uuid.UUID(data["user1_id"]),
                election_id=uuid.UUID(data["election_id"]),
                candidate_id=uuid.UUID(cid),
                position="Chief",
                organization_id=uuid.UUID(data["org_id"]),
                vote_rank=rank,
            )
            assert err is None, f"Rank {rank} vote failed: {err}"
            assert vote is not None

    async def test_ranked_choice_duplicate_rank_rejected(
        self, db_session: AsyncSession, setup_election
    ):
        data = await setup_election
        await self._set_method(db_session, data["election_id"], "ranked_choice")
        svc = ElectionService(db_session)

        _, err1 = await svc.cast_vote(
            user_id=uuid.UUID(data["user1_id"]),
            election_id=uuid.UUID(data["election_id"]),
            candidate_id=uuid.UUID(data["candidate_a_id"]),
            position="Chief",
            organization_id=uuid.UUID(data["org_id"]),
            vote_rank=1,
        )
        assert err1 is None

        vote2, err2 = await svc.cast_vote(
            user_id=uuid.UUID(data["user1_id"]),
            election_id=uuid.UUID(data["election_id"]),
            candidate_id=uuid.UUID(data["candidate_b_id"]),
            position="Chief",
            organization_id=uuid.UUID(data["org_id"]),
            vote_rank=1,
        )
        assert vote2 is None
        assert err2 is not None
        assert "rank" in err2.lower()

    async def test_ranked_choice_duplicate_candidate_rejected(
        self, db_session: AsyncSession, setup_election
    ):
        data = await setup_election
        await self._set_method(db_session, data["election_id"], "ranked_choice")
        svc = ElectionService(db_session)

        _, err1 = await svc.cast_vote(
            user_id=uuid.UUID(data["user1_id"]),
            election_id=uuid.UUID(data["election_id"]),
            candidate_id=uuid.UUID(data["candidate_a_id"]),
            position="Chief",
            organization_id=uuid.UUID(data["org_id"]),
            vote_rank=1,
        )
        assert err1 is None

        vote2, err2 = await svc.cast_vote(
            user_id=uuid.UUID(data["user1_id"]),
            election_id=uuid.UUID(data["election_id"]),
            candidate_id=uuid.UUID(data["candidate_a_id"]),
            position="Chief",
            organization_id=uuid.UUID(data["org_id"]),
            vote_rank=2,
        )
        assert vote2 is None
        assert err2 is not None


# ── TestRunoffCreation (B4) ───────────────────────────────────────────


class TestRunoffCreation(TestElectionSetup):
    async def test_early_close_still_creates_runoff(
        self, db_session: AsyncSession, setup_election
    ):
        """Closing before end_date (the normal way to end a meeting vote)
        must still evaluate runoff conditions — the results-visibility gate
        previously returned None and the runoff was silently skipped."""
        from sqlalchemy import text

        data = await setup_election
        await db_session.execute(
            text(
                "UPDATE elections SET enable_runoffs = 1, "
                "victory_condition = 'majority' WHERE id = :id"
            ),
            {"id": data["election_id"]},
        )
        await db_session.flush()
        svc = ElectionService(db_session)

        # 1-1 tie with 'majority' → no winner → runoff required
        for uid, cid in [
            (data["user1_id"], data["candidate_a_id"]),
            (data["user2_id"], data["candidate_b_id"]),
        ]:
            _, err = await svc.cast_vote(
                user_id=uuid.UUID(uid),
                election_id=uuid.UUID(data["election_id"]),
                candidate_id=uuid.UUID(cid),
                position="Chief",
                organization_id=uuid.UUID(data["org_id"]),
            )
            assert err is None

        # end_date is tomorrow — this is an early close
        closed, close_err = await svc.close_election(
            uuid.UUID(data["election_id"]),
            uuid.UUID(data["org_id"]),
        )
        assert close_err is None
        assert closed is not None

        runoff_row = await db_session.execute(
            text(
                "SELECT COUNT(*) FROM elections "
                "WHERE parent_election_id = :id AND is_runoff = 1"
            ),
            {"id": data["election_id"]},
        )
        assert (
            runoff_row.scalar() or 0
        ) == 1, "Early close must still create the runoff election"


# ── TestResultsVisibilityGate ─────────────────────────────────────────


class TestResultsVisibilityGate(TestElectionSetup):
    async def test_results_hidden_before_end_date_without_bypass(
        self, db_session: AsyncSession, setup_election
    ):
        data = await setup_election
        svc = ElectionService(db_session)

        _, err = await svc.cast_vote(
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

        # Closed but end_date still in the future and results not flagged
        # visible: the public results call must stay gated...
        hidden = await svc.get_election_results(
            uuid.UUID(data["election_id"]), uuid.UUID(data["org_id"])
        )
        assert hidden is None

        # ...while internal consumers (runoff check, report email) can read
        visible = await svc.get_election_results(
            uuid.UUID(data["election_id"]),
            uuid.UUID(data["org_id"]),
            _internal_bypass_visibility=True,
        )
        assert visible is not None

    async def test_results_org_scoped(self, db_session: AsyncSession, setup_election):
        data = await setup_election
        svc = ElectionService(db_session)

        foreign = await svc.get_election_results(
            uuid.UUID(data["election_id"]),
            uuid.uuid4(),
            _internal_bypass_visibility=True,
        )
        assert foreign is None, "Foreign org must never read results"


# ── TestRollbackGuard (ELEC-4) ────────────────────────────────────────


class TestRollbackGuard(TestElectionSetup):
    async def test_rollback_refused_after_salt_destroyed_with_votes(
        self, db_session: AsyncSession, setup_election
    ):
        """Reopening a closed anonymous election whose salt was destroyed
        would let prior voters vote again (their hashes no longer match)."""
        data = await setup_election
        svc = ElectionService(db_session)

        _, err = await svc.cast_vote(
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
        assert (
            closed.voter_anonymity_salt is None
        ), "close_election should destroy the anonymity salt"

        election, notifications, rb_err = await svc.rollback_election(
            uuid.UUID(data["election_id"]),
            uuid.UUID(data["org_id"]),
            performed_by=uuid.UUID(data["user1_id"]),
            reason="Trying to reopen",
        )

        assert election is None
        assert rb_err is not None
        assert "anonymity salt" in rb_err

    async def test_rollback_allowed_when_no_votes(
        self, db_session: AsyncSession, setup_election
    ):
        data = await setup_election
        svc = ElectionService(db_session)

        closed, close_err = await svc.close_election(
            uuid.UUID(data["election_id"]),
            uuid.UUID(data["org_id"]),
        )
        assert close_err is None

        election, notifications, rb_err = await svc.rollback_election(
            uuid.UUID(data["election_id"]),
            uuid.UUID(data["org_id"]),
            performed_by=uuid.UUID(data["user1_id"]),
            reason="No votes cast yet",
        )

        assert rb_err is None, f"Rollback with zero votes should work: {rb_err}"
        assert election is not None
        assert election.status.value == "open"


# ── TestRunoffInheritance & Open Clamp ────────────────────────────────


class TestRunoffInheritance(TestElectionSetup):
    async def test_runoff_inherits_rules_with_fresh_salt(
        self, db_session: AsyncSession, setup_election
    ):
        """A runoff must carry the parent's quorum and position eligibility,
        and get its OWN anonymity salt (never none, never the parent's —
        the parent's salt is destroyed at close and an empty salt would make
        voter hashes pre-computable)."""
        from sqlalchemy import text

        data = await setup_election
        await db_session.execute(
            text(
                "UPDATE elections SET enable_runoffs = 1, "
                "victory_condition = 'majority', "
                "quorum_type = 'percentage', quorum_value = 51, "
                "position_eligibility = "
                '\'{"Chief": {"voter_types": ["operational"]}}\' '
                "WHERE id = :id"
            ),
            {"id": data["election_id"]},
        )
        await db_session.flush()
        svc = ElectionService(db_session)

        # 1-1 tie with 'majority' -> runoff
        for uid, cid in [
            (data["user1_id"], data["candidate_a_id"]),
            (data["user2_id"], data["candidate_b_id"]),
        ]:
            _, err = await svc.cast_vote(
                user_id=uuid.UUID(uid),
                election_id=uuid.UUID(data["election_id"]),
                candidate_id=uuid.UUID(cid),
                position="Chief",
                organization_id=uuid.UUID(data["org_id"]),
            )
            assert err is None

        _, close_err = await svc.close_election(
            uuid.UUID(data["election_id"]), uuid.UUID(data["org_id"])
        )
        assert close_err is None

        runoff_row = await db_session.execute(
            text(
                "SELECT voter_anonymity_salt, quorum_type, quorum_value, "
                "position_eligibility, anonymous_voting "
                "FROM elections WHERE parent_election_id = :id"
            ),
            {"id": data["election_id"]},
        )
        runoff = runoff_row.one()

        assert runoff.voter_anonymity_salt, "Runoff must have its own salt"
        assert (
            runoff.voter_anonymity_salt != data["salt"]
        ), "Runoff salt must not be a copy of the parent's"
        assert runoff.quorum_type == "percentage"
        assert runoff.quorum_value == 51
        assert runoff.position_eligibility is not None
        assert "operational" in str(runoff.position_eligibility)


class TestOpenElectionStartClamp(TestElectionSetup):
    async def test_open_clamps_future_start_so_voting_works_immediately(
        self, db_session: AsyncSession, setup_election
    ):
        """Opening is the declaration that voting starts now. A future
        start_date (e.g. the runoff default of now+1h) must be clamped on
        open, or every vote bounces with 'Election has not started yet'."""
        from sqlalchemy import text

        data = await setup_election
        future_start = datetime.now(timezone.utc) + timedelta(hours=1)
        await db_session.execute(
            text(
                "UPDATE elections SET status = 'draft', start_date = :start "
                "WHERE id = :id"
            ),
            {"start": future_start, "id": data["election_id"]},
        )
        await db_session.flush()
        svc = ElectionService(db_session)

        opened, err = await svc.open_election(
            uuid.UUID(data["election_id"]), uuid.UUID(data["org_id"])
        )
        assert err is None
        assert opened is not None

        vote, vote_err = await svc.cast_vote(
            user_id=uuid.UUID(data["user1_id"]),
            election_id=uuid.UUID(data["election_id"]),
            candidate_id=uuid.UUID(data["candidate_a_id"]),
            position="Chief",
            organization_id=uuid.UUID(data["org_id"]),
        )
        assert (
            vote_err is None
        ), f"Vote should succeed immediately after open: {vote_err}"
        assert vote is not None

    async def test_open_rejects_election_whose_end_has_passed(
        self, db_session: AsyncSession, setup_election
    ):
        from sqlalchemy import text

        data = await setup_election
        past = datetime.now(timezone.utc) - timedelta(days=2)
        await db_session.execute(
            text(
                "UPDATE elections SET status = 'draft', "
                "start_date = :start, end_date = :end WHERE id = :id"
            ),
            {
                "start": past,
                "end": past + timedelta(days=1),
                "id": data["election_id"],
            },
        )
        await db_session.flush()
        svc = ElectionService(db_session)

        opened, err = await svc.open_election(
            uuid.UUID(data["election_id"]), uuid.UUID(data["org_id"])
        )
        assert opened is None
        assert err is not None
        assert "end date" in err.lower()


# ── TestIpMetadataPurge (ELEC-6) ──────────────────────────────────────


class TestIpMetadataPurge(TestElectionSetup):
    async def test_anonymous_close_purges_vote_ip_metadata(
        self, db_session: AsyncSession, setup_election
    ):
        """Closing an anonymous election must erase per-vote IP/user-agent
        (alongside the salt) so votes can't be correlated to voters."""
        from sqlalchemy import text

        data = await setup_election
        svc = ElectionService(db_session)

        _, err = await svc.cast_vote(
            user_id=uuid.UUID(data["user1_id"]),
            election_id=uuid.UUID(data["election_id"]),
            candidate_id=uuid.UUID(data["candidate_a_id"]),
            position="Chief",
            organization_id=uuid.UUID(data["org_id"]),
            ip_address="203.0.113.7",
            user_agent="test-agent",
        )
        assert err is None

        _, close_err = await svc.close_election(
            uuid.UUID(data["election_id"]), uuid.UUID(data["org_id"])
        )
        assert close_err is None

        row = await db_session.execute(
            text(
                "SELECT ip_address, user_agent FROM votes " "WHERE election_id = :eid"
            ),
            {"eid": data["election_id"]},
        )
        ip, ua = row.one()
        assert ip is None, "IP must be purged at close for anonymous elections"
        assert ua is None, "User-agent must be purged at close"

    async def test_non_anonymous_close_keeps_ip_metadata(
        self, db_session: AsyncSession, setup_election
    ):
        from sqlalchemy import text

        data = await setup_election
        await db_session.execute(
            text("UPDATE elections SET anonymous_voting = 0 WHERE id = :id"),
            {"id": data["election_id"]},
        )
        await db_session.flush()
        svc = ElectionService(db_session)

        _, err = await svc.cast_vote(
            user_id=uuid.UUID(data["user1_id"]),
            election_id=uuid.UUID(data["election_id"]),
            candidate_id=uuid.UUID(data["candidate_a_id"]),
            position="Chief",
            organization_id=uuid.UUID(data["org_id"]),
            ip_address="203.0.113.7",
            user_agent="test-agent",
        )
        assert err is None

        _, close_err = await svc.close_election(
            uuid.UUID(data["election_id"]), uuid.UUID(data["org_id"])
        )
        assert close_err is None

        row = await db_session.execute(
            text("SELECT ip_address FROM votes WHERE election_id = :eid"),
            {"eid": data["election_id"]},
        )
        assert (
            row.scalar() == "203.0.113.7"
        ), "Non-anonymous elections keep IP metadata for accountability"

    async def test_forensics_exposes_threshold_only_ip_data(
        self, db_session: AsyncSession, setup_election
    ):
        """The forensics report must not contain a full per-IP vote map —
        only the thresholded suspicious set plus aggregate counts."""
        data = await setup_election
        svc = ElectionService(db_session)

        for uid, cid in [
            (data["user1_id"], data["candidate_a_id"]),
            (data["user2_id"], data["candidate_b_id"]),
        ]:
            _, err = await svc.cast_vote(
                user_id=uuid.UUID(uid),
                election_id=uuid.UUID(data["election_id"]),
                candidate_id=uuid.UUID(cid),
                position="Chief",
                organization_id=uuid.UUID(data["org_id"]),
                ip_address="203.0.113.7",
            )
            assert err is None

        forensics = await svc.get_election_forensics(
            uuid.UUID(data["election_id"]), uuid.UUID(data["org_id"])
        )

        anomaly = forensics["anomaly_detection"]
        assert "ip_vote_distribution" not in anomaly
        assert anomaly["unique_ip_count"] == 1
        assert anomaly["ip_metadata_purged"] is False
        # 2 votes from one IP is below the >5 threshold — not suspicious
        assert anomaly["suspicious_ips"] == {}


# ── Audit-log IP minimization for anonymous elections (ELEC-6) ────────


class TestAnonymousAuditIpMinimization(TestElectionSetup):
    """Voter-action audit events must not record an IP for anonymous
    elections: audit rows are hash-chained and can never be scrubbed,
    unlike Vote.ip_address (purged at close)."""

    async def _last_audit_ip(self, db_session, election_id: str, event_type: str):
        from sqlalchemy import text

        row = await db_session.execute(
            text(
                "SELECT ip_address FROM audit_logs "
                "WHERE event_type = :etype "
                "AND JSON_UNQUOTE(JSON_EXTRACT(event_data, '$.election_id')) = :eid "
                "ORDER BY id DESC LIMIT 1"
            ),
            {"etype": event_type, "eid": election_id},
        )
        return row.scalar_one()

    async def test_anonymous_vote_audit_has_no_ip(
        self, db_session: AsyncSession, setup_election
    ):
        data = await setup_election
        svc = ElectionService(db_session)

        _, err = await svc.cast_vote(
            user_id=uuid.UUID(data["user1_id"]),
            election_id=uuid.UUID(data["election_id"]),
            candidate_id=uuid.UUID(data["candidate_a_id"]),
            position="Chief",
            organization_id=uuid.UUID(data["org_id"]),
            ip_address="203.0.113.7",
            user_agent="test-agent",
        )
        assert err is None

        ip = await self._last_audit_ip(db_session, data["election_id"], "vote_cast")
        assert ip is None, "Anonymous election must not write voter IP to audit log"

    async def test_non_anonymous_vote_audit_keeps_ip(
        self, db_session: AsyncSession, setup_election
    ):
        from sqlalchemy import text

        data = await setup_election
        await db_session.execute(
            text("UPDATE elections SET anonymous_voting = 0 WHERE id = :id"),
            {"id": data["election_id"]},
        )
        await db_session.flush()
        svc = ElectionService(db_session)

        _, err = await svc.cast_vote(
            user_id=uuid.UUID(data["user1_id"]),
            election_id=uuid.UUID(data["election_id"]),
            candidate_id=uuid.UUID(data["candidate_a_id"]),
            position="Chief",
            organization_id=uuid.UUID(data["org_id"]),
            ip_address="203.0.113.7",
            user_agent="test-agent",
        )
        assert err is None

        ip = await self._last_audit_ip(db_session, data["election_id"], "vote_cast")
        assert ip == "203.0.113.7", "Non-anonymous elections keep audit IPs"

    async def test_audit_chain_valid_after_anonymous_vote(
        self, db_session: AsyncSession, setup_election
    ):
        """A NULL-IP audit row is a normal chain input — integrity holds."""
        from app.core.audit import AuditLogger

        data = await setup_election
        svc = ElectionService(db_session)

        _, err = await svc.cast_vote(
            user_id=uuid.UUID(data["user1_id"]),
            election_id=uuid.UUID(data["election_id"]),
            candidate_id=uuid.UUID(data["candidate_a_id"]),
            position="Chief",
            organization_id=uuid.UUID(data["org_id"]),
            ip_address="203.0.113.7",
        )
        assert err is None

        result = await AuditLogger().verify_integrity(db_session)
        assert result["verified"] is True, result
