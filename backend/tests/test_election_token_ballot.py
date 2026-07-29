"""
Election Token Ballot — Integration Tests

Covers the anonymous token voting path fixes from the 2026-07 elections
security review:
  - Per-item eligibility enforced at submission time (token snapshot)
  - Test-ballot tokens produce is_test votes excluded from results
  - Receipt hashes returned to the voter and verifiable
  - Positionless token votes not blocked by unrelated positioned votes
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


class TestTokenBallotSetup:
    """Shared fixture: org, one voter, an OPEN ballot-item election."""

    @pytest.fixture
    async def setup_ballot_election(self, db_session: AsyncSession):
        """Election with two ballot items: item_a (all) and item_b (life only)."""
        org_id = _uid()
        user_id = _uid()
        election_id = _uid()
        salt = secrets.token_hex(32)

        now = datetime.now(timezone.utc)

        await db_session.execute(
            text(
                "INSERT INTO organizations (id, name, organization_type, slug, timezone) "
                "VALUES (:id, :name, :otype, :slug, :tz)"
            ),
            {
                "id": org_id,
                "name": "Token Ballot FD",
                "otype": "fire_department",
                "slug": f"tok-{org_id[:8]}",
                "tz": "America/New_York",
            },
        )

        await db_session.execute(
            text(
                "INSERT INTO users "
                "(id, organization_id, username, first_name, last_name, "
                "email, password_hash, status) "
                "VALUES (:id, :org, :un, :fn, :ln, :em, :pw, 'active')"
            ),
            {
                "id": user_id,
                "org": org_id,
                "un": "tokenvoter",
                "fn": "Tina",
                "ln": "Token",
                "em": "tokenvoter@test.com",
                "pw": "hashed",
            },
        )

        ballot_items = (
            '[{"id": "item_a", "type": "general_vote", "title": "Budget Approval", '
            '"eligible_voter_types": ["all"], "vote_type": "approval"}, '
            '{"id": "item_b", "type": "general_vote", "title": "Bylaw Amendment", '
            '"eligible_voter_types": ["life"], "vote_type": "approval"}]'
        )

        await db_session.execute(
            text(
                "INSERT INTO elections "
                "(id, organization_id, title, election_type, ballot_items, "
                "start_date, end_date, status, anonymous_voting, "
                "allow_write_ins, max_votes_per_position, voting_method, "
                "victory_condition, voter_anonymity_salt, quorum_type, "
                "created_by) "
                "VALUES (:id, :org, :title, :etype, :items, "
                ":start, :end, :status, :anon, :write_in, :max_votes, "
                ":method, :victory, :salt, :quorum, :creator)"
            ),
            {
                "id": election_id,
                "org": org_id,
                "title": "Meeting Ballot 2026",
                "etype": "general",
                "items": ballot_items,
                "start": now - timedelta(days=1),
                "end": now + timedelta(days=1),
                "status": "open",
                "anon": True,
                "write_in": False,
                "max_votes": 1,
                "method": "simple_majority",
                "victory": "most_votes",
                "salt": salt,
                "quorum": "none",
                "creator": user_id,
            },
        )

        await db_session.flush()

        return {
            "org_id": org_id,
            "user_id": user_id,
            "election_id": election_id,
            "salt": salt,
        }

    async def _issue_token(
        self,
        db_session: AsyncSession,
        data: dict,
        *,
        is_test: bool = False,
        eligible_item_ids=None,
    ):
        """Generate a voting token via the real service helper.

        Returns (VotingToken, raw_token) — the row stores only the hash.
        """
        svc = ElectionService(db_session)
        token, raw = await svc._generate_voting_token(
            user_id=uuid.UUID(data["user_id"]),
            election_id=uuid.UUID(data["election_id"]),
            organization_id=uuid.UUID(data["org_id"]),
            election_end_date=datetime.now(timezone.utc) + timedelta(days=1),
            anonymity_salt=data["salt"],
            is_test=is_test,
            eligible_item_ids=eligible_item_ids,
        )
        await db_session.flush()
        return token, raw


# ── Per-item eligibility enforcement (B2) ─────────────────────────────


class TestPerItemEligibility(TestTokenBallotSetup):
    async def test_vote_on_ineligible_item_rejected(
        self, db_session: AsyncSession, setup_ballot_election
    ):
        data = await setup_ballot_election
        token, raw_token = await self._issue_token(
            db_session, data, eligible_item_ids=["item_a"]
        )
        svc = ElectionService(db_session)

        result, err = await svc.submit_ballot_with_token(
            token=raw_token,
            votes=[
                {"ballot_item_id": "item_a", "choice": "approve"},
                {"ballot_item_id": "item_b", "choice": "approve"},
            ],
        )

        assert result is None
        assert err is not None
        assert "not eligible" in err.lower()
        assert "Bylaw Amendment" in err

    async def test_abstain_on_ineligible_item_allowed(
        self, db_session: AsyncSession, setup_ballot_election
    ):
        data = await setup_ballot_election
        token, raw_token = await self._issue_token(
            db_session, data, eligible_item_ids=["item_a"]
        )
        svc = ElectionService(db_session)

        result, err = await svc.submit_ballot_with_token(
            token=raw_token,
            votes=[
                {"ballot_item_id": "item_a", "choice": "approve"},
                {"ballot_item_id": "item_b", "choice": "abstain"},
            ],
        )

        assert err is None, f"Expected success, got: {err}"
        assert result["votes_cast"] == 1
        assert result["abstentions"] == 1

    async def test_legacy_token_without_snapshot_unrestricted(
        self, db_session: AsyncSession, setup_ballot_election
    ):
        """Tokens issued before the migration have eligible_item_ids=NULL and
        must keep working (fail-open bounded by token expiry)."""
        data = await setup_ballot_election
        token, raw_token = await self._issue_token(
            db_session, data, eligible_item_ids=None
        )
        svc = ElectionService(db_session)

        result, err = await svc.submit_ballot_with_token(
            token=raw_token,
            votes=[
                {"ballot_item_id": "item_a", "choice": "approve"},
                {"ballot_item_id": "item_b", "choice": "deny"},
            ],
        )

        assert err is None, f"Expected success, got: {err}"
        assert result["votes_cast"] == 2


# ── Test-ballot tokens (B1) ───────────────────────────────────────────


class TestTestBallotTokens(TestTokenBallotSetup):
    async def test_test_token_votes_marked_and_excluded_from_results(
        self, db_session: AsyncSession, setup_ballot_election
    ):
        data = await setup_ballot_election
        token, raw_token = await self._issue_token(db_session, data, is_test=True)
        svc = ElectionService(db_session)

        result, err = await svc.submit_ballot_with_token(
            token=raw_token,
            votes=[{"ballot_item_id": "item_a", "choice": "approve"}],
        )
        assert err is None, f"Expected success, got: {err}"

        marked = await db_session.execute(
            text(
                "SELECT COUNT(*) FROM votes " "WHERE election_id = :eid AND is_test = 1"
            ),
            {"eid": data["election_id"]},
        )
        assert (marked.scalar() or 0) == 1

        results = await svc.get_election_results(
            uuid.UUID(data["election_id"]),
            uuid.UUID(data["org_id"]),
            _internal_bypass_visibility=True,
        )
        assert results is not None
        assert results.total_votes == 0, "Test votes must not count in results"

        stats = await svc.get_election_stats(
            uuid.UUID(data["election_id"]), uuid.UUID(data["org_id"])
        )
        assert stats.total_votes_cast == 0, "Test votes must not count in stats"

    async def test_real_vote_succeeds_after_test_vote(
        self, db_session: AsyncSession, setup_ballot_election
    ):
        """A manager's test submission must not consume their real vote slot
        (the dedup input is namespaced for test tokens)."""
        data = await setup_ballot_election
        test_token, test_raw = await self._issue_token(db_session, data, is_test=True)
        svc = ElectionService(db_session)

        _, err_test = await svc.submit_ballot_with_token(
            token=test_raw,
            votes=[{"ballot_item_id": "item_a", "choice": "approve"}],
        )
        assert err_test is None, f"Test ballot failed: {err_test}"

        real_token, real_raw = await self._issue_token(db_session, data, is_test=False)
        result, err_real = await svc.submit_ballot_with_token(
            token=real_raw,
            votes=[{"ballot_item_id": "item_a", "choice": "deny"}],
        )
        assert err_real is None, f"Real ballot blocked by prior test ballot: {err_real}"
        assert result["votes_cast"] == 1

        results = await svc.get_election_results(
            uuid.UUID(data["election_id"]),
            uuid.UUID(data["org_id"]),
            _internal_bypass_visibility=True,
        )
        assert results.total_votes == 1, "Only the real vote should count"


# ── Receipt hashes (B10 / ELEC-8) ─────────────────────────────────────


class TestReceiptHashes(TestTokenBallotSetup):
    async def test_submission_returns_verifiable_receipts(
        self, db_session: AsyncSession, setup_ballot_election
    ):
        data = await setup_ballot_election
        token, raw_token = await self._issue_token(db_session, data)
        svc = ElectionService(db_session)

        result, err = await svc.submit_ballot_with_token(
            token=raw_token,
            votes=[
                {"ballot_item_id": "item_a", "choice": "approve"},
                {"ballot_item_id": "item_b", "choice": "deny"},
            ],
        )
        assert err is None, f"Expected success, got: {err}"
        assert len(result["receipt_hashes"]) == 2

        for receipt in result["receipt_hashes"]:
            row = await db_session.execute(
                text(
                    "SELECT COUNT(*) FROM votes "
                    "WHERE election_id = :eid AND receipt_hash = :r"
                ),
                {"eid": data["election_id"], "r": receipt},
            )
            assert (row.scalar() or 0) == 1, "Receipt must map to a stored vote"


# ── Positionless dedup check (B8) ─────────────────────────────────────


class TestPositionlessTokenVote(TestTokenBallotSetup):
    @pytest.fixture
    async def setup_candidate_election(
        self, db_session: AsyncSession, setup_ballot_election
    ):
        """Add a positionless candidate election in the same org."""
        data = await setup_ballot_election
        election_id = _uid()
        candidate_id = _uid()
        now = datetime.now(timezone.utc)

        await db_session.execute(
            text(
                "INSERT INTO elections "
                "(id, organization_id, title, election_type, "
                "start_date, end_date, status, anonymous_voting, "
                "allow_write_ins, max_votes_per_position, voting_method, "
                "victory_condition, voter_anonymity_salt, quorum_type, "
                "created_by) "
                "VALUES (:id, :org, :title, :etype, "
                ":start, :end, :status, :anon, :write_in, :max_votes, "
                ":method, :victory, :salt, :quorum, :creator)"
            ),
            {
                "id": election_id,
                "org": data["org_id"],
                "title": "Positionless Poll",
                "etype": "poll",
                "start": now - timedelta(days=1),
                "end": now + timedelta(days=1),
                "status": "open",
                "anon": True,
                "write_in": False,
                "max_votes": 1,
                "method": "simple_majority",
                "victory": "most_votes",
                "salt": data["salt"],
                "quorum": "none",
                "creator": data["user_id"],
            },
        )
        await db_session.execute(
            text(
                "INSERT INTO candidates "
                "(id, election_id, name, accepted, is_write_in, display_order) "
                "VALUES (:id, :eid, :name, 1, 0, 0)"
            ),
            {"id": candidate_id, "eid": election_id, "name": "Yes"},
        )
        await db_session.flush()
        return {**data, "poll_id": election_id, "poll_candidate_id": candidate_id}

    async def test_positionless_vote_not_blocked_by_positioned_vote(
        self, db_session: AsyncSession, setup_candidate_election
    ):
        """A stray positioned vote by the same voter hash must not block a
        positionless submission (the old filter degraded to a no-op and
        matched every prior vote)."""
        data = await setup_candidate_election
        svc = ElectionService(db_session)

        token, raw_token = await svc._generate_voting_token(
            user_id=uuid.UUID(data["user_id"]),
            election_id=uuid.UUID(data["poll_id"]),
            organization_id=uuid.UUID(data["org_id"]),
            election_end_date=datetime.now(timezone.utc) + timedelta(days=1),
            anonymity_salt=data["salt"],
        )
        await db_session.flush()

        # Seed an unrelated positioned vote under the same voter hash
        await db_session.execute(
            text(
                "INSERT INTO votes "
                "(id, election_id, candidate_id, voter_hash, position, "
                "voted_at, is_test, is_proxy_vote) "
                "VALUES (:id, :eid, :cid, :vh, 'SomePosition', :at, 0, 0)"
            ),
            {
                "id": _uid(),
                "eid": data["poll_id"],
                "cid": data["poll_candidate_id"],
                "vh": token.voter_hash,
                "at": datetime.now(timezone.utc),
            },
        )
        await db_session.flush()

        vote, err = await svc.cast_vote_with_token(
            token=raw_token,
            candidate_id=uuid.UUID(data["poll_candidate_id"]),
            position=None,
        )

        assert (
            err is None
        ), f"Positionless vote wrongly blocked by positioned vote: {err}"
        assert vote is not None
        assert vote.position is None


# ── Token hashing at rest (ELEC-5) ────────────────────────────────────


class TestTokenHashedAtRest(TestTokenBallotSetup):
    async def test_stored_token_is_hash_and_raw_resolves(
        self, db_session: AsyncSession, setup_ballot_election
    ):
        """The DB row must hold SHA-256(token); the raw token (emailed link)
        resolves, and the stored hash itself must NOT work as a credential —
        exactly what makes DB read access useless to an attacker."""
        data = await setup_ballot_election
        token, raw_token = await self._issue_token(db_session, data)

        assert token.token != raw_token
        assert len(token.token) == 64
        assert all(c in "0123456789abcdef" for c in token.token)

        svc = ElectionService(db_session)
        election, resolved, err = await svc.get_ballot_by_token(raw_token)
        assert err is None, f"Raw token must resolve: {err}"
        assert str(resolved.id) == str(token.id)

        # Presenting the stored hash is re-hashed on lookup and must fail
        _, _, err2 = await svc.get_ballot_by_token(token.token)
        assert err2 is not None
