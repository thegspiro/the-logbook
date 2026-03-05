"""
Elections Module — Security & Integrity Tests

Tests covering vote signing, dedup hashes, chain hashing, receipt hashes,
voter anonymity, quorum enforcement, per-item victory conditions, empty
ballot prevention, and other hardening features.
"""

import hashlib
import hmac as hmac_module
import secrets
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from typing import Optional
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import pytest

from app.models.election import Candidate, Election, ElectionStatus, Vote


# ---------------------------------------------------------------------------
# Helpers — lightweight stubs that don't require a real DB session
# ---------------------------------------------------------------------------


def _make_election(**overrides) -> SimpleNamespace:
    """Create a stub Election-like namespace with sensible defaults."""
    defaults = dict(
        id=str(uuid4()),
        organization_id=str(uuid4()),
        title="Test Election",
        election_type="general",
        status=ElectionStatus.OPEN,
        start_date=datetime.now(timezone.utc) - timedelta(days=1),
        end_date=datetime.now(timezone.utc) + timedelta(days=1),
        anonymous_voting=True,
        allow_write_ins=False,
        max_votes_per_position=1,
        results_visible_immediately=False,
        voting_method="simple_majority",
        victory_condition="most_votes",
        victory_percentage=None,
        victory_threshold=None,
        enable_runoffs=False,
        runoff_type="top_two",
        max_runoff_rounds=3,
        is_runoff=False,
        parent_election_id=None,
        runoff_round=0,
        voter_anonymity_salt=secrets.token_hex(32),
        quorum_type="none",
        quorum_value=None,
        last_chain_hash=None,
        positions=None,
        ballot_items=None,
        eligible_voters=None,
        position_eligibility=None,
        attendees=None,
        voter_overrides=None,
        proxy_authorizations=None,
        email_sent=False,
        email_sent_at=None,
        email_recipients=None,
        meeting_date=None,
        meeting_id=None,
        rollback_history=None,
        created_by=str(uuid4()),
        created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc),
    )
    defaults.update(overrides)
    return SimpleNamespace(**defaults)


def _make_vote(election_id: str, **overrides) -> SimpleNamespace:
    """Create a stub Vote-like namespace with sensible defaults."""
    defaults = dict(
        id=str(uuid4()),
        election_id=election_id,
        candidate_id=str(uuid4()),
        voter_id=str(uuid4()),
        voter_hash=None,
        position=None,
        vote_rank=None,
        voted_at=datetime.now(timezone.utc),
        vote_signature=None,
        vote_dedup_hash=None,
        chain_hash=None,
        receipt_hash=None,
        is_test=False,
        is_proxy_vote=False,
        proxy_voter_id=None,
        proxy_authorization_id=None,
        proxy_delegating_user_id=None,
        ip_address=None,
        user_agent=None,
        deleted_at=None,
        deleted_by=None,
        deletion_reason=None,
    )
    defaults.update(overrides)
    return SimpleNamespace(**defaults)


def _make_service(signing_key: str = "test-signing-key"):
    """Create an ElectionService with a mocked DB session and config."""
    from app.services.election_service import ElectionService

    db = AsyncMock()
    service = ElectionService(db)

    # Patch the signing key lookup to return a stable test key
    service._get_vote_signing_key = lambda: signing_key  # type: ignore[assignment]
    return service


# ===================================================================
# 1. Vote Signing & Integrity
# ===================================================================


class TestVoteSigning:
    """Verify _sign_vote produces deterministic HMAC-SHA256 and detects tampering."""

    def test_sign_vote_deterministic(self):
        service = _make_service()
        election = _make_election()
        vote = _make_vote(
            election.id,
            voter_hash="abc123",
            position="Chief",
            vote_rank=None,
            is_proxy_vote=False,
            proxy_delegating_user_id=None,
        )
        sig1 = service._sign_vote(vote)
        sig2 = service._sign_vote(vote)
        assert sig1 == sig2, "Signature must be deterministic"

    def test_sign_vote_includes_vote_rank(self):
        service = _make_service()
        election = _make_election()
        vote_a = _make_vote(election.id, voter_hash="x", vote_rank=1)
        vote_b = _make_vote(
            election.id,
            id=vote_a.id,
            candidate_id=vote_a.candidate_id,
            voter_hash="x",
            voted_at=vote_a.voted_at,
            vote_rank=2,
        )
        sig_a = service._sign_vote(vote_a)
        sig_b = service._sign_vote(vote_b)
        assert sig_a != sig_b, "Different vote_rank must produce different signatures"

    def test_sign_vote_includes_proxy_fields(self):
        service = _make_service()
        election = _make_election()
        base = dict(
            id=str(uuid4()),
            candidate_id=str(uuid4()),
            voter_hash="v",
            position=None,
            vote_rank=None,
            voted_at=datetime.now(timezone.utc),
        )
        vote_normal = _make_vote(election.id, **base, is_proxy_vote=False, proxy_delegating_user_id=None)
        vote_proxy = _make_vote(election.id, **base, is_proxy_vote=True, proxy_delegating_user_id=str(uuid4()))
        assert service._sign_vote(vote_normal) != service._sign_vote(vote_proxy)

    def test_sign_vote_tampered_candidate_detected(self):
        service = _make_service()
        election = _make_election()
        vote = _make_vote(election.id, voter_hash="h")
        original_sig = service._sign_vote(vote)
        # Tamper the candidate
        object.__setattr__(vote, "candidate_id", str(uuid4()))
        assert service._sign_vote(vote) != original_sig

    def test_sign_vote_uses_signing_key(self):
        service_a = _make_service(signing_key="key-A")
        service_b = _make_service(signing_key="key-B")
        election = _make_election()
        vote = _make_vote(election.id, voter_hash="h")
        assert service_a._sign_vote(vote) != service_b._sign_vote(vote)


# ===================================================================
# 2. Vote Dedup Hash (MySQL double-vote prevention)
# ===================================================================


class TestVoteDedupHash:
    def test_same_inputs_produce_same_hash(self):
        from app.services.election_service import ElectionService

        eid = uuid4()
        h1 = ElectionService._compute_vote_dedup_hash(eid, "voter1", "Chief")
        h2 = ElectionService._compute_vote_dedup_hash(eid, "voter1", "Chief")
        assert h1 == h2

    def test_different_positions_produce_different_hashes(self):
        from app.services.election_service import ElectionService

        eid = uuid4()
        h1 = ElectionService._compute_vote_dedup_hash(eid, "voter1", "Chief")
        h2 = ElectionService._compute_vote_dedup_hash(eid, "voter1", "President")
        assert h1 != h2

    def test_none_position_uses_sentinel(self):
        from app.services.election_service import ElectionService

        eid = uuid4()
        h = ElectionService._compute_vote_dedup_hash(eid, "voter1", None)
        expected_data = f"{eid}:voter1:__NO_POS__"
        expected = hashlib.sha256(expected_data.encode()).hexdigest()
        assert h == expected

    def test_different_elections_produce_different_hashes(self):
        from app.services.election_service import ElectionService

        h1 = ElectionService._compute_vote_dedup_hash(uuid4(), "voter1", "Chief")
        h2 = ElectionService._compute_vote_dedup_hash(uuid4(), "voter1", "Chief")
        assert h1 != h2


# ===================================================================
# 3. Sequential Vote Chain Hash
# ===================================================================


class TestChainHash:
    def test_genesis_chain(self):
        service = _make_service()
        chain = service._compute_chain_hash(None, "sig1")
        expected = hashlib.sha256("GENESIS:sig1".encode()).hexdigest()
        assert chain == expected

    def test_chain_links(self):
        service = _make_service()
        c1 = service._compute_chain_hash(None, "sig1")
        c2 = service._compute_chain_hash(c1, "sig2")
        expected = hashlib.sha256(f"{c1}:sig2".encode()).hexdigest()
        assert c2 == expected

    def test_chain_is_order_sensitive(self):
        service = _make_service()
        c_ab = service._compute_chain_hash(
            service._compute_chain_hash(None, "a"), "b"
        )
        c_ba = service._compute_chain_hash(
            service._compute_chain_hash(None, "b"), "a"
        )
        assert c_ab != c_ba


# ===================================================================
# 4. Receipt Hash
# ===================================================================


class TestReceiptHash:
    def test_receipt_is_non_empty_sha256(self):
        from app.services.election_service import ElectionService

        receipt = ElectionService._compute_receipt_hash("vote-id-1", "sig-1")
        assert len(receipt) == 64  # SHA256 hex
        assert all(c in "0123456789abcdef" for c in receipt)

    def test_receipt_is_unique_per_call(self):
        """Receipt includes a random nonce so two calls never match."""
        from app.services.election_service import ElectionService

        r1 = ElectionService._compute_receipt_hash("v", "s")
        r2 = ElectionService._compute_receipt_hash("v", "s")
        assert r1 != r2


# ===================================================================
# 5. Voter Anonymity Hash
# ===================================================================


class TestVoterAnonymityHash:
    def test_same_salt_same_hash(self):
        service = _make_service()
        uid = uuid4()
        eid = uuid4()
        h1 = service._generate_voter_hash(uid, eid, "salt-abc")
        h2 = service._generate_voter_hash(uid, eid, "salt-abc")
        assert h1 == h2

    def test_different_salt_different_hash(self):
        """Per-election salt means hashes change each election."""
        service = _make_service()
        uid = uuid4()
        eid = uuid4()
        h1 = service._generate_voter_hash(uid, eid, "salt1")
        h2 = service._generate_voter_hash(uid, eid, "salt2")
        assert h1 != h2

    def test_empty_salt_still_works(self):
        service = _make_service()
        h = service._generate_voter_hash(uuid4(), uuid4(), "")
        assert len(h) == 64


# ===================================================================
# 6. Victory Condition Validation
# ===================================================================


class TestVictoryConditions:
    """Verify per-item victory condition override logic in schemas."""

    def test_ballot_item_schema_accepts_victory_override(self):
        from app.schemas.election import BallotItem

        item = BallotItem(
            id="item1",
            title="Bylaw Amendment",
            type="general_vote",
            victory_condition="supermajority",
            victory_percentage=67,
        )
        assert item.victory_condition == "supermajority"
        assert item.victory_percentage == 67

    def test_ballot_item_defaults_to_none_override(self):
        from app.schemas.election import BallotItem

        item = BallotItem(id="item2", title="Officer Vote", type="officer_election")
        assert item.victory_condition is None
        assert item.victory_percentage is None

    def test_quorum_schema_validation(self):
        from app.schemas.election import ElectionCreate

        data = {
            "title": "Q Test",
            "election_type": "general",
            "start_date": datetime.now(timezone.utc).isoformat(),
            "end_date": (datetime.now(timezone.utc) + timedelta(days=1)).isoformat(),
            "quorum_type": "percentage",
            "quorum_value": 51,
        }
        ec = ElectionCreate(**data)
        assert ec.quorum_type == "percentage"
        assert ec.quorum_value == 51

    def test_quorum_schema_rejects_invalid_value(self):
        from pydantic import ValidationError

        from app.schemas.election import ElectionCreate

        data = {
            "title": "Q Test",
            "election_type": "general",
            "start_date": datetime.now(timezone.utc).isoformat(),
            "end_date": (datetime.now(timezone.utc) + timedelta(days=1)).isoformat(),
            "quorum_type": "percentage",
            "quorum_value": 0,  # ge=1 should reject
        }
        with pytest.raises(ValidationError):
            ElectionCreate(**data)


# ===================================================================
# 7. Status Transitions
# ===================================================================


class TestElectionStatusEnum:
    def test_status_values(self):
        assert ElectionStatus.DRAFT.value == "draft"
        assert ElectionStatus.OPEN.value == "open"
        assert ElectionStatus.CLOSED.value == "closed"
        assert ElectionStatus.CANCELLED.value == "cancelled"

    def test_status_is_str_enum(self):
        assert isinstance(ElectionStatus.DRAFT, str)
        assert ElectionStatus.OPEN == "open"


# ===================================================================
# 8. Model Field Presence
# ===================================================================


class TestModelFields:
    """Ensure new security columns exist on the Vote model."""

    def test_vote_has_dedup_hash_column(self):
        cols = {c.name for c in Vote.__table__.columns}
        assert "vote_dedup_hash" in cols

    def test_vote_has_chain_hash_column(self):
        cols = {c.name for c in Vote.__table__.columns}
        assert "chain_hash" in cols

    def test_vote_has_receipt_hash_column(self):
        cols = {c.name for c in Vote.__table__.columns}
        assert "receipt_hash" in cols

    def test_vote_has_is_test_column(self):
        cols = {c.name for c in Vote.__table__.columns}
        assert "is_test" in cols

    def test_election_has_quorum_columns(self):
        cols = {c.name for c in Election.__table__.columns}
        assert "quorum_type" in cols
        assert "quorum_value" in cols

    def test_election_has_last_chain_hash_column(self):
        cols = {c.name for c in Election.__table__.columns}
        assert "last_chain_hash" in cols


# ===================================================================
# 9. Vote Signing Key Fallback
# ===================================================================


class TestSigningKeyFallback:
    def test_get_signing_key_uses_dedicated_key(self):
        from app.services.election_service import ElectionService

        db = AsyncMock()
        service = ElectionService(db)
        with patch("app.services.election_service.settings") as mock_settings:
            mock_settings.VOTE_SIGNING_KEY = "dedicated-key"
            mock_settings.SECRET_KEY = "secret-key"
            assert service._get_vote_signing_key() == "dedicated-key"

    def test_get_signing_key_falls_back_to_secret(self):
        from app.services.election_service import ElectionService

        db = AsyncMock()
        service = ElectionService(db)
        with patch("app.services.election_service.settings") as mock_settings:
            mock_settings.VOTE_SIGNING_KEY = ""
            mock_settings.SECRET_KEY = "fallback-key"
            assert service._get_vote_signing_key() == "fallback-key"


# ===================================================================
# 10. Empty Ballot Prevention Helper
# ===================================================================


class TestEligibleBallotItems:
    """Test _get_eligible_ballot_items_for_user."""

    @pytest.mark.asyncio
    async def test_no_ballot_items_returns_empty(self):
        service = _make_service()
        election = _make_election(ballot_items=None)
        user = MagicMock()
        user.id = str(uuid4())
        user.roles = []

        # Mock the DB call for organization lookup
        mock_result = MagicMock()
        mock_result.scalar_one_or_none.return_value = None
        service.db.execute = AsyncMock(return_value=mock_result)

        items = await service._get_eligible_ballot_items_for_user(
            user, election, election.organization_id
        )
        assert items == []

    @pytest.mark.asyncio
    async def test_all_items_eligible_when_no_restrictions(self):
        service = _make_service()
        ballot_items = [
            {"id": "1", "title": "Item 1", "eligible_voter_types": ["all"]},
            {"id": "2", "title": "Item 2", "eligible_voter_types": ["all"]},
        ]
        election = _make_election(ballot_items=ballot_items, voter_overrides=None)
        user = MagicMock()
        user.id = str(uuid4())
        user.roles = []
        user.membership_type = "active"

        # Mock org with no tier restrictions
        mock_org = MagicMock()
        mock_org.settings = {}
        mock_result = MagicMock()
        mock_result.scalar_one_or_none.return_value = mock_org
        service.db.execute = AsyncMock(return_value=mock_result)

        items = await service._get_eligible_ballot_items_for_user(
            user, election, election.organization_id
        )
        assert len(items) == 2

    @pytest.mark.asyncio
    async def test_ineligible_tier_filters_all_items(self):
        service = _make_service()
        ballot_items = [
            {"id": "1", "title": "Item 1", "eligible_voter_types": ["all"]},
        ]
        election = _make_election(ballot_items=ballot_items, voter_overrides=None)
        user = MagicMock()
        user.id = str(uuid4())
        user.roles = []
        user.membership_type = "probationary"

        # Mock org with tier that marks probationary as non-voting
        mock_org = MagicMock()
        mock_org.settings = {
            "membership_tiers": {
                "tiers": [
                    {
                        "id": "probationary",
                        "name": "Probationary",
                        "benefits": {"voting_eligible": False},
                    }
                ]
            }
        }
        mock_result = MagicMock()
        mock_result.scalar_one_or_none.return_value = mock_org
        service.db.execute = AsyncMock(return_value=mock_result)

        items = await service._get_eligible_ballot_items_for_user(
            user, election, election.organization_id
        )
        assert len(items) == 0

    @pytest.mark.asyncio
    async def test_secretary_override_bypasses_tier_restriction(self):
        service = _make_service()
        user_id = str(uuid4())
        ballot_items = [
            {"id": "1", "title": "Item 1", "eligible_voter_types": ["all"]},
        ]
        election = _make_election(
            ballot_items=ballot_items,
            voter_overrides=[{"user_id": user_id}],
        )
        user = MagicMock()
        user.id = user_id
        user.roles = []
        user.membership_type = "probationary"

        # Same ineligible tier
        mock_org = MagicMock()
        mock_org.settings = {
            "membership_tiers": {
                "tiers": [
                    {
                        "id": "probationary",
                        "name": "Probationary",
                        "benefits": {"voting_eligible": False},
                    }
                ]
            }
        }
        mock_result = MagicMock()
        mock_result.scalar_one_or_none.return_value = mock_org
        service.db.execute = AsyncMock(return_value=mock_result)

        items = await service._get_eligible_ballot_items_for_user(
            user, election, election.organization_id
        )
        assert len(items) == 1, "Secretary override should bypass tier check"

    @pytest.mark.asyncio
    async def test_role_type_filters_items(self):
        service = _make_service()
        ballot_items = [
            {"id": "1", "title": "Officer Vote", "eligible_voter_types": ["operational"]},
            {"id": "2", "title": "General Vote", "eligible_voter_types": ["all"]},
        ]
        election = _make_election(ballot_items=ballot_items, voter_overrides=None)

        # User without an operational role
        user = MagicMock()
        user.id = str(uuid4())
        user.roles = []  # no roles at all
        user.membership_type = "active"
        user.status = "active"

        mock_org = MagicMock()
        mock_org.settings = {}
        mock_result = MagicMock()
        mock_result.scalar_one_or_none.return_value = mock_org
        service.db.execute = AsyncMock(return_value=mock_result)

        items = await service._get_eligible_ballot_items_for_user(
            user, election, election.organization_id
        )
        # Should only get the "all" item, not the "operational" one
        assert len(items) == 1
        assert items[0]["id"] == "2"


# ===================================================================
# 11. Email Ballot Response Schema
# ===================================================================


class TestEmailBallotResponseSchema:
    def test_skipped_count_defaults_to_zero(self):
        from app.schemas.election import EmailBallotResponse

        resp = EmailBallotResponse(
            success=True,
            recipients_count=5,
            failed_count=0,
            message="ok",
        )
        assert resp.skipped_count == 0

    def test_skipped_count_can_be_set(self):
        from app.schemas.election import EmailBallotResponse

        resp = EmailBallotResponse(
            success=True,
            recipients_count=5,
            failed_count=0,
            skipped_count=3,
            message="ok",
        )
        assert resp.skipped_count == 3


# ===================================================================
# 12. Election Results Schema — Quorum Fields
# ===================================================================


class TestElectionResultsSchema:
    def test_quorum_fields_present(self):
        from app.schemas.election import ElectionResults

        er = ElectionResults(
            election_id=str(uuid4()),
            election_title="Test",
            status="closed",
            total_votes=0,
            total_eligible_voters=10,
            voter_turnout_percentage=0.0,
            results_by_position=[],
            overall_results=[],
            quorum_met=False,
            quorum_detail="Quorum not met: 5 of 10 required voters participated",
        )
        assert er.quorum_met is False
        assert er.quorum_detail is not None


# ===================================================================
# 13. VoteResponse — receipt_hash field
# ===================================================================


class TestVoteResponseSchema:
    def test_receipt_hash_field(self):
        from app.schemas.election import VoteResponse

        vr = VoteResponse(
            id=str(uuid4()),
            election_id=str(uuid4()),
            candidate_id=str(uuid4()),
            voted_at=datetime.now(timezone.utc),
            receipt_hash="abc123def456",
        )
        assert vr.receipt_hash == "abc123def456"


# ===================================================================
# 14. Write-in Sanitization
# ===================================================================


class TestWriteInSanitization:
    def test_html_escape_prevents_xss(self):
        import html

        malicious = '<script>alert("xss")</script>'
        safe = html.escape(malicious)
        assert "<script>" not in safe
        assert "&lt;script&gt;" in safe

    def test_html_escape_is_idempotent_for_safe_strings(self):
        import html

        safe = "John Smith"
        assert html.escape(safe) == safe


# ===================================================================
# 15. Verify Vote Integrity — Chain Break Detection
# ===================================================================


class TestVerifyIntegrityChain:
    """Unit-test the chain-verification logic in isolation."""

    def test_unbroken_chain_passes(self):
        service = _make_service()
        # Simulate 3 votes with correct chain
        sig1, sig2, sig3 = "sig-a", "sig-b", "sig-c"
        c1 = service._compute_chain_hash(None, sig1)
        c2 = service._compute_chain_hash(c1, sig2)
        c3 = service._compute_chain_hash(c2, sig3)

        # Walk the chain
        prev = "GENESIS"
        for sig, expected_chain in [(sig1, c1), (sig2, c2), (sig3, c3)]:
            actual = service._compute_chain_hash(prev, sig)
            assert actual == expected_chain
            prev = actual

    def test_deleted_vote_breaks_chain(self):
        service = _make_service()
        sig1, sig2, sig3 = "sig-a", "sig-b", "sig-c"
        c1 = service._compute_chain_hash(None, sig1)
        c2 = service._compute_chain_hash(c1, sig2)
        c3 = service._compute_chain_hash(c2, sig3)

        # If vote 2 is deleted, walking GENESIS→sig1→sig3 should fail at c3
        prev = "GENESIS"
        prev = service._compute_chain_hash(prev, sig1)
        # Skip sig2
        recomputed_c3 = service._compute_chain_hash(prev, sig3)
        assert recomputed_c3 != c3, "Skipping a vote must break the chain"

    def test_reordered_votes_break_chain(self):
        service = _make_service()
        sig1, sig2 = "sig-a", "sig-b"
        c1 = service._compute_chain_hash(None, sig1)
        c2 = service._compute_chain_hash(c1, sig2)

        # Reverse order: sig2 first
        r1 = service._compute_chain_hash(None, sig2)
        r2 = service._compute_chain_hash(r1, sig1)
        assert r2 != c2, "Reordering votes must produce different chain"
