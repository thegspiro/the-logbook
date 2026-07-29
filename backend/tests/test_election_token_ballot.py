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
from sqlalchemy import select, text
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
                "created_by, email_sent, results_visible_immediately, "
                "enable_runoffs, runoff_type, max_runoff_rounds, "
                "is_runoff, runoff_round, created_at, updated_at) "
                "VALUES (:id, :org, :title, :etype, :items, "
                ":start, :end, :status, :anon, :write_in, :max_votes, "
                ":method, :victory, :salt, :quorum, :creator, 0, 0, 0, 'top_two', 3, 0, 0, NOW(), NOW())"
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
        eligible_positions=None,
        user_id: str | None = None,
    ):
        """Generate a voting token via the real service helper.

        Returns (VotingToken, raw_token) — the row stores only the hash.
        """
        svc = ElectionService(db_session)
        token, raw = await svc._generate_voting_token(
            user_id=uuid.UUID(user_id or data["user_id"]),
            election_id=uuid.UUID(data["election_id"]),
            organization_id=uuid.UUID(data["org_id"]),
            election_end_date=datetime.now(timezone.utc) + timedelta(days=1),
            anonymity_salt=data["salt"],
            is_test=is_test,
            eligible_item_ids=eligible_item_ids,
            eligible_positions=eligible_positions,
        )
        await db_session.flush()
        return token, raw


# ── Per-item eligibility enforcement (B2) ─────────────────────────────


class TestPerItemEligibility(TestTokenBallotSetup):
    async def test_vote_on_ineligible_item_rejected(
        self, db_session: AsyncSession, setup_ballot_election
    ):
        data = setup_ballot_election
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
        data = setup_ballot_election
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
        data = setup_ballot_election
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
        data = setup_ballot_election
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
        data = setup_ballot_election
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
        data = setup_ballot_election
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
        data = setup_ballot_election
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
                "created_by, email_sent, results_visible_immediately, "
                "enable_runoffs, runoff_type, max_runoff_rounds, "
                "is_runoff, runoff_round, created_at, updated_at) "
                "VALUES (:id, :org, :title, :etype, "
                ":start, :end, :status, :anon, :write_in, :max_votes, "
                ":method, :victory, :salt, :quorum, :creator, 0, 0, 0, 'top_two', 3, 0, 0, NOW(), NOW())"
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
                "(id, election_id, name, accepted, is_write_in, display_order, "
                "nomination_date, created_at, updated_at) "
                "VALUES (:id, :eid, :name, 1, 0, 0, NOW(), NOW(), NOW())"
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
        data = setup_candidate_election
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
        data = setup_ballot_election
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


# ── Position eligibility on the token path (R-D4) ─────────────────────


class TestPositionEligibilityTokens(TestTokenBallotSetup):
    """position_eligibility enforced for token ballots via the send-time
    eligible_positions snapshot (tokens carry no user identity)."""

    @pytest.fixture
    async def setup_positional_election(self, db_session: AsyncSession):
        """Two-position election: Chief (operational only), President (all).

        Two members: an operational (active) firefighter and an
        administrative member who may not vote for Chief.
        """
        org_id = _uid()
        active_id = _uid()
        admin_id = _uid()
        election_id = _uid()
        cand_chief_id = _uid()
        cand_pres_id = _uid()
        salt = secrets.token_hex(32)
        now = datetime.now(timezone.utc)

        await db_session.execute(
            text(
                "INSERT INTO organizations (id, name, organization_type, slug, timezone) "
                "VALUES (:id, :name, :otype, :slug, :tz)"
            ),
            {
                "id": org_id,
                "name": "Positional FD",
                "otype": "fire_department",
                "slug": f"pos-{org_id[:8]}",
                "tz": "America/New_York",
            },
        )

        for uid, uname, mtype in [
            (active_id, "opmember", "active"),
            (admin_id, "adminmember", "administrative"),
        ]:
            await db_session.execute(
                text(
                    "INSERT INTO users "
                    "(id, organization_id, username, first_name, last_name, "
                    "email, password_hash, status, membership_type) "
                    "VALUES (:id, :org, :un, :fn, :ln, :em, :pw, 'active', :mt)"
                ),
                {
                    "id": uid,
                    "org": org_id,
                    "un": uname,
                    "fn": uname.title(),
                    "ln": "Member",
                    "em": f"{uname}@test.com",
                    "pw": "hashed",
                    "mt": mtype,
                },
            )

        await db_session.execute(
            text(
                "INSERT INTO elections "
                "(id, organization_id, title, election_type, positions, "
                "position_eligibility, start_date, end_date, status, "
                "anonymous_voting, allow_write_ins, max_votes_per_position, "
                "voting_method, victory_condition, voter_anonymity_salt, "
                "quorum_type, created_by, email_sent, results_visible_immediately, "
                "enable_runoffs, runoff_type, max_runoff_rounds, "
                "is_runoff, runoff_round, created_at, updated_at) "
                "VALUES (:id, :org, :title, :etype, :positions, :pos_elig, "
                ":start, :end, :status, :anon, :write_in, :max_votes, "
                ":method, :victory, :salt, :quorum, :creator, 0, 0, 0, 'top_two', 3, 0, 0, NOW(), NOW())"
            ),
            {
                "id": election_id,
                "org": org_id,
                "title": "Officer Election 2026",
                "etype": "officer",
                "positions": '["Chief", "President"]',
                "pos_elig": (
                    '{"Chief": {"voter_types": ["operational"]}, '
                    '"President": {"voter_types": ["all"]}}'
                ),
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
                "creator": active_id,
            },
        )

        for cid, pos, order in [
            (cand_chief_id, "Chief", 0),
            (cand_pres_id, "President", 1),
        ]:
            await db_session.execute(
                text(
                    "INSERT INTO candidates "
                    "(id, election_id, name, position, accepted, is_write_in, "
                    "display_order, nomination_date, created_at, updated_at) "
                    "VALUES (:id, :eid, :name, :pos, :acc, :wi, :ord, "
                    "NOW(), NOW(), NOW())"
                ),
                {
                    "id": cid,
                    "eid": election_id,
                    "name": f"Candidate {pos}",
                    "pos": pos,
                    "acc": True,
                    "wi": False,
                    "ord": order,
                },
            )

        await db_session.flush()

        return {
            "org_id": org_id,
            "user_id": active_id,
            "admin_id": admin_id,
            "election_id": election_id,
            "cand_chief_id": cand_chief_id,
            "cand_pres_id": cand_pres_id,
            "salt": salt,
        }

    async def test_restricted_token_rejected_for_ineligible_position(
        self, db_session: AsyncSession, setup_positional_election
    ):
        data = setup_positional_election
        _, raw = await self._issue_token(
            db_session, data, user_id=data["admin_id"], eligible_positions=["President"]
        )
        svc = ElectionService(db_session)

        vote, err = await svc.cast_vote_with_token(
            token=raw,
            candidate_id=uuid.UUID(data["cand_chief_id"]),
            position="Chief",
        )
        assert vote is None
        assert err == "You are not eligible to vote for Chief"

    async def test_restricted_token_accepted_for_eligible_position(
        self, db_session: AsyncSession, setup_positional_election
    ):
        data = setup_positional_election
        _, raw = await self._issue_token(
            db_session, data, user_id=data["admin_id"], eligible_positions=["President"]
        )
        svc = ElectionService(db_session)

        vote, err = await svc.cast_vote_with_token(
            token=raw,
            candidate_id=uuid.UUID(data["cand_pres_id"]),
            position="President",
        )
        assert err is None, f"Eligible-position vote failed: {err}"
        assert vote is not None

    async def test_omitted_position_cannot_bypass_restriction(
        self, db_session: AsyncSession, setup_positional_election
    ):
        """The check falls back to candidate.position when the payload omits
        the position field."""
        data = setup_positional_election
        _, raw = await self._issue_token(
            db_session, data, user_id=data["admin_id"], eligible_positions=["President"]
        )
        svc = ElectionService(db_session)

        vote, err = await svc.cast_vote_with_token(
            token=raw,
            candidate_id=uuid.UUID(data["cand_chief_id"]),
            position=None,
        )
        assert vote is None
        assert err == "You are not eligible to vote for Chief"

    async def test_legacy_token_without_snapshot_unrestricted(
        self, db_session: AsyncSession, setup_positional_election
    ):
        """NULL snapshot = pre-migration token — documented fail-open."""
        data = setup_positional_election
        _, raw = await self._issue_token(
            db_session, data, user_id=data["admin_id"], eligible_positions=None
        )
        svc = ElectionService(db_session)

        vote, err = await svc.cast_vote_with_token(
            token=raw,
            candidate_id=uuid.UUID(data["cand_chief_id"]),
            position="Chief",
        )
        assert err is None
        assert vote is not None

    async def test_restricted_token_used_after_covering_eligible_positions(
        self, db_session: AsyncSession, setup_positional_election
    ):
        """A token restricted to one position is fully used after that one
        vote, even though the election has more positions."""
        from app.models.election import VotingToken

        data = setup_positional_election
        token_row, raw = await self._issue_token(
            db_session, data, user_id=data["admin_id"], eligible_positions=["President"]
        )
        svc = ElectionService(db_session)

        vote, err = await svc.cast_vote_with_token(
            token=raw,
            candidate_id=uuid.UUID(data["cand_pres_id"]),
            position="President",
        )
        assert err is None

        refreshed = (
            await db_session.execute(
                select(VotingToken).where(VotingToken.token == token_row.token)
            )
        ).scalar_one()
        assert refreshed.used is True
        assert refreshed.used_at is not None

    async def test_send_ballot_emails_snapshots_and_skips(
        self, db_session: AsyncSession, setup_positional_election
    ):
        """The real send path computes per-member snapshots from
        position_eligibility and skips members eligible for nothing."""
        from unittest.mock import AsyncMock, patch

        from app.models.election import VotingToken

        data = setup_positional_election

        # Restrict President to operational too, so the administrative
        # member is eligible for zero positions and must be skipped.
        await db_session.execute(
            text("UPDATE elections SET position_eligibility = :pe WHERE id = :id"),
            {
                "pe": (
                    '{"Chief": {"voter_types": ["operational"]}, '
                    '"President": {"voter_types": ["operational"]}}'
                ),
                "id": data["election_id"],
            },
        )
        await db_session.flush()

        svc = ElectionService(db_session)
        with patch(
            "app.services.email_service.EmailService.send_batch",
            new=AsyncMock(side_effect=lambda batch: [True] * len(batch)),
        ):
            sent, failed, skipped, skipped_details, _sent_ids = await svc.send_ballot_emails(
                election_id=uuid.UUID(data["election_id"]),
                organization_id=uuid.UUID(data["org_id"]),
                recipient_user_ids=[
                    uuid.UUID(data["user_id"]),
                    uuid.UUID(data["admin_id"]),
                ],
                base_ballot_url="https://fd.example/ballot",
            )

        assert sent == 1, f"expected 1 sent, got {sent} (skipped: {skipped_details})"
        assert skipped == 1
        assert "position" in skipped_details[0]["reason"]

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
        assert tokens[0].eligible_positions == ["Chief", "President"]


# ── Method-aware token voting (R-D5) ──────────────────────────────────


class TestMethodAwareTokenVoting(TestTokenBallotSetup):
    """Approval multi-select, ranked rankings, and single-vote parity on
    the token paths."""

    @pytest.fixture
    async def setup_candidate_election(self, db_session: AsyncSession):
        """Approval-method election with one candidate-selection ballot item
        ("Board", 3 candidates)."""
        org_id = _uid()
        user_id = _uid()
        election_id = _uid()
        cand_ids = [_uid(), _uid(), _uid()]
        salt = secrets.token_hex(32)
        now = datetime.now(timezone.utc)

        await db_session.execute(
            text(
                "INSERT INTO organizations (id, name, organization_type, slug, timezone) "
                "VALUES (:id, :name, :otype, :slug, :tz)"
            ),
            {
                "id": org_id,
                "name": "Method FD",
                "otype": "fire_department",
                "slug": f"mth-{org_id[:8]}",
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
                "un": "methodvoter",
                "fn": "Mia",
                "ln": "Method",
                "em": "methodvoter@test.com",
                "pw": "hashed",
            },
        )

        ballot_items = (
            '[{"id": "board", "type": "officer_election", "title": "Board Seats", '
            '"eligible_voter_types": ["all"], "vote_type": "candidate_selection", '
            '"position": "Board"}]'
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
                "VALUES (:id, :org, :title, :etype, :items, "
                ":start, :end, :status, :anon, :write_in, :max_votes, "
                ":method, :victory, :salt, :quorum, :creator, 0, 0, 0, 'top_two', 3, 0, 0, NOW(), NOW())"
            ),
            {
                "id": election_id,
                "org": org_id,
                "title": "Board Election 2026",
                "etype": "officer",
                "items": ballot_items,
                "start": now - timedelta(days=1),
                "end": now + timedelta(days=1),
                "status": "open",
                "anon": True,
                "write_in": False,
                "max_votes": 1,
                "method": "approval",
                "victory": "most_votes",
                "salt": salt,
                "quorum": "none",
                "creator": user_id,
            },
        )
        for i, cid in enumerate(cand_ids):
            await db_session.execute(
                text(
                    "INSERT INTO candidates "
                    "(id, election_id, name, position, accepted, is_write_in, "
                    "display_order, nomination_date, created_at, updated_at) "
                    "VALUES (:id, :eid, :name, :pos, :acc, :wi, :ord, "
                    "NOW(), NOW(), NOW())"
                ),
                {
                    "id": cid,
                    "eid": election_id,
                    "name": f"Board Candidate {i + 1}",
                    "pos": "Board",
                    "acc": True,
                    "wi": False,
                    "ord": i,
                },
            )
        await db_session.flush()

        return {
            "org_id": org_id,
            "user_id": user_id,
            "election_id": election_id,
            "cand_ids": cand_ids,
            "salt": salt,
        }

    async def _set_method(self, db_session, election_id: str, method: str):
        await db_session.execute(
            text("UPDATE elections SET voting_method = :m WHERE id = :id"),
            {"m": method, "id": election_id},
        )
        await db_session.flush()

    async def test_bulk_approval_multi_select_creates_one_vote_per_candidate(
        self, db_session: AsyncSession, setup_candidate_election
    ):
        data = setup_candidate_election
        _, raw = await self._issue_token(db_session, data)
        svc = ElectionService(db_session)

        result, err = await svc.submit_ballot_with_token(
            token=raw,
            votes=[{"ballot_item_id": "board", "candidate_ids": data["cand_ids"][:2]}],
        )
        assert err is None, f"Approval multi-select failed: {err}"
        assert result["votes_cast"] == 2
        assert len(result["receipt_hashes"]) == 2
        assert len(set(result["receipt_hashes"])) == 2

        from app.models.election import Vote

        votes = (
            (
                await db_session.execute(
                    select(Vote).where(Vote.election_id == data["election_id"])
                )
            )
            .scalars()
            .all()
        )
        assert len(votes) == 2
        assert len({v.vote_dedup_hash for v in votes}) == 2

    async def test_bulk_rankings_create_ranked_votes(
        self, db_session: AsyncSession, setup_candidate_election
    ):
        data = setup_candidate_election
        await self._set_method(db_session, data["election_id"], "ranked_choice")
        _, raw = await self._issue_token(db_session, data)
        svc = ElectionService(db_session)

        ordered = [data["cand_ids"][2], data["cand_ids"][0]]
        result, err = await svc.submit_ballot_with_token(
            token=raw,
            votes=[{"ballot_item_id": "board", "rankings": ordered}],
        )
        assert err is None, f"Ranked submission failed: {err}"
        assert result["votes_cast"] == 2

        from app.models.election import Vote

        votes = (
            (
                await db_session.execute(
                    select(Vote)
                    .where(Vote.election_id == data["election_id"])
                    .order_by(Vote.vote_rank)
                )
            )
            .scalars()
            .all()
        )
        assert [(str(v.candidate_id), v.vote_rank) for v in votes] == [
            (ordered[0], 1),
            (ordered[1], 2),
        ]

    async def test_bulk_rankings_rejected_for_non_ranked_method(
        self, db_session: AsyncSession, setup_candidate_election
    ):
        data = setup_candidate_election  # approval method
        _, raw = await self._issue_token(db_session, data)
        svc = ElectionService(db_session)

        result, err = await svc.submit_ballot_with_token(
            token=raw,
            votes=[{"ballot_item_id": "board", "rankings": data["cand_ids"][:2]}],
        )
        assert result is None
        assert "Ranked votes are not accepted" in err

    async def test_bulk_multi_select_over_cap_rejected(
        self, db_session: AsyncSession, setup_candidate_election
    ):
        data = setup_candidate_election
        # simple_majority with max 2 selections per position
        await self._set_method(db_session, data["election_id"], "simple_majority")
        await db_session.execute(
            text("UPDATE elections SET max_votes_per_position = 2 WHERE id = :id"),
            {"id": data["election_id"]},
        )
        await db_session.flush()
        _, raw = await self._issue_token(db_session, data)
        svc = ElectionService(db_session)

        result, err = await svc.submit_ballot_with_token(
            token=raw,
            votes=[{"ballot_item_id": "board", "candidate_ids": data["cand_ids"]}],
        )
        assert result is None
        assert "Too many selections" in err

    async def test_single_token_endpoint_ranked_requires_rank(
        self, db_session: AsyncSession, setup_candidate_election
    ):
        data = setup_candidate_election
        await self._set_method(db_session, data["election_id"], "ranked_choice")
        _, raw = await self._issue_token(db_session, data)
        svc = ElectionService(db_session)

        vote, err = await svc.cast_vote_with_token(
            token=raw,
            candidate_id=uuid.UUID(data["cand_ids"][0]),
            position="Board",
        )
        assert vote is None
        assert err == "vote_rank is required for ranked-choice voting"

    async def test_single_token_endpoint_ranked_flow(
        self, db_session: AsyncSession, setup_candidate_election
    ):
        data = setup_candidate_election
        await self._set_method(db_session, data["election_id"], "ranked_choice")
        _, raw = await self._issue_token(db_session, data)
        svc = ElectionService(db_session)

        v1, err1 = await svc.cast_vote_with_token(
            token=raw,
            candidate_id=uuid.UUID(data["cand_ids"][0]),
            position="Board",
            vote_rank=1,
        )
        assert err1 is None
        assert v1.vote_rank == 1

        # Same rank again → rejected
        _, err2 = await svc.cast_vote_with_token(
            token=raw,
            candidate_id=uuid.UUID(data["cand_ids"][1]),
            position="Board",
            vote_rank=1,
        )
        assert "rank-1" in err2

        # Same candidate at a new rank → rejected
        _, err3 = await svc.cast_vote_with_token(
            token=raw,
            candidate_id=uuid.UUID(data["cand_ids"][0]),
            position="Board",
            vote_rank=2,
        )
        assert err3 == "You have already ranked this candidate"

        # Different candidate at rank 2 → accepted
        v4, err4 = await svc.cast_vote_with_token(
            token=raw,
            candidate_id=uuid.UUID(data["cand_ids"][1]),
            position="Board",
            vote_rank=2,
        )
        assert err4 is None
        assert v4.vote_rank == 2

    async def test_single_token_endpoint_approval_multiple_candidates(
        self, db_session: AsyncSession, setup_candidate_election
    ):
        from app.models.election import VotingToken

        data = setup_candidate_election  # approval method
        token_row, raw = await self._issue_token(db_session, data)
        svc = ElectionService(db_session)

        v1, err1 = await svc.cast_vote_with_token(
            token=raw,
            candidate_id=uuid.UUID(data["cand_ids"][0]),
            position="Board",
        )
        assert err1 is None

        # The token must remain usable for further approval votes
        refreshed = (
            await db_session.execute(
                select(VotingToken).where(VotingToken.token == token_row.token)
            )
        ).scalar_one()
        assert refreshed.used is False

        # Same candidate again → rejected
        _, err2 = await svc.cast_vote_with_token(
            token=raw,
            candidate_id=uuid.UUID(data["cand_ids"][0]),
            position="Board",
        )
        assert err2 == "You have already voted for this candidate"

        # A second candidate → accepted
        _, err3 = await svc.cast_vote_with_token(
            token=raw,
            candidate_id=uuid.UUID(data["cand_ids"][1]),
            position="Board",
        )
        assert err3 is None


# ── Token out of GET URLs (R-D3) ──────────────────────────────────────


class TestBallotTokenUrlHygiene(TestPositionEligibilityTokens):
    """The emailed link carries the token in a URL fragment (never sent to
    any server) and the lookup endpoint takes it in a POST body."""

    async def test_emailed_ballot_link_uses_fragment(
        self, db_session: AsyncSession, setup_positional_election
    ):
        from unittest.mock import AsyncMock, patch

        data = setup_positional_election
        svc = ElectionService(db_session)

        captured_urls = []

        async def _capture_render(**kwargs):
            captured_urls.append(kwargs.get("ballot_url"))
            return ("subject", "<html></html>", "text")

        with (
            patch(
                "app.services.email_service.EmailService.render_ballot_notification",
                new=AsyncMock(side_effect=_capture_render),
            ),
            patch(
                "app.services.email_service.EmailService.send_batch",
                new=AsyncMock(side_effect=lambda batch: [True] * len(batch)),
            ),
        ):
            sent, failed, skipped, _, _sent_ids = await svc.send_ballot_emails(
                election_id=uuid.UUID(data["election_id"]),
                organization_id=uuid.UUID(data["org_id"]),
                recipient_user_ids=[uuid.UUID(data["user_id"])],
                base_ballot_url="https://fd.example/ballot",
            )

        assert sent == 1, f"send failed (failed={failed}, skipped={skipped})"
        assert len(captured_urls) == 1
        url = captured_urls[0]
        assert url.startswith("https://fd.example/ballot#token="), url
        assert "?token=" not in url

    async def test_lookup_endpoint_filters_by_eligible_positions(
        self, db_session: AsyncSession, setup_positional_election
    ):
        from app.api.v1.endpoints.elections import (
            BallotLookupRequest,
            lookup_ballot_by_token,
        )

        data = setup_positional_election
        _, raw = await self._issue_token(
            db_session,
            data,
            user_id=data["admin_id"],
            eligible_positions=["President"],
        )

        result = await lookup_ballot_by_token(
            payload=BallotLookupRequest(token=raw),
            db=db_session,
            _rate=None,
        )

        assert result.election.title == "Officer Election 2026"
        assert result.election.positions == ["President"]
        candidate_positions = {c.position for c in result.candidates}
        assert candidate_positions == {"President"}

    async def test_lookup_endpoint_unrestricted_token_sees_everything(
        self, db_session: AsyncSession, setup_positional_election
    ):
        from app.api.v1.endpoints.elections import (
            BallotLookupRequest,
            lookup_ballot_by_token,
        )

        data = setup_positional_election
        _, raw = await self._issue_token(db_session, data, user_id=data["user_id"])

        result = await lookup_ballot_by_token(
            payload=BallotLookupRequest(token=raw),
            db=db_session,
            _rate=None,
        )

        assert result.election.positions == ["Chief", "President"]
        assert {c.position for c in result.candidates} == {"Chief", "President"}

    async def test_lookup_endpoint_rejects_invalid_token(
        self, db_session: AsyncSession, setup_positional_election
    ):
        from fastapi import HTTPException

        from app.api.v1.endpoints.elections import (
            BallotLookupRequest,
            lookup_ballot_by_token,
        )

        with pytest.raises(HTTPException) as exc_info:
            await lookup_ballot_by_token(
                payload=BallotLookupRequest(token="not-a-real-token"),
                db=db_session,
                _rate=None,
            )
        assert exc_info.value.status_code == 400
