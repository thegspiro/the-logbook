"""
Elections — regression tests for re-verified Codex review findings.

Covers:
- cast_vote takes the election row lock before eligibility reads and uses a
  locking read for the duplicate-vote check (concurrent double-vote race).
- clone_election strips prospect_package_id from cloned ballot items so a
  clone's votes can never overwrite the original applicant package status.
- cast_vote_with_token treats legacy NULL-position votes as duplicates of the
  effective position and books positions_voted by effective position.
- _count_ballots_cast honors per-ballot-item voting-method overrides when
  deciding whether per-position sums are a safe per-voter count.
- date-pair validators normalize naive datetimes to UTC so a mixed
  naive/aware payload is a 422 (ValidationError), not a TypeError → 500.
- the strict ballot-item id pattern applies to input only; response models
  still deserialize legacy stored ids (spaces/punctuation) without a 500.
- the effective-quorum PATCH check runs only when the update touches quorum
  fields, so legacy rows with quorum_type != none and quorum_value NULL
  stay editable (title-only PATCH succeeds).
"""

import secrets
import uuid as uuid_module
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock
from uuid import UUID, uuid4

import pytest
from pydantic import ValidationError
from sqlalchemy import text

from app.models.election import ElectionStatus
from app.schemas.election import (
    BallotItem,
    CloneElectionRequest,
    ElectionCreate,
    ElectionResponse,
    ElectionUpdate,
    SavedBallotTemplateCreate,
)
from app.services.election_service import ElectionService

# ---------------------------------------------------------------------------
# Helpers — lightweight stubs that don't require a real DB session
# ---------------------------------------------------------------------------


def _scalar_result(value):
    result = MagicMock()
    result.scalar_one_or_none.return_value = value
    return result


class TestTokenSubmissionLocking:
    async def test_rejects_token_used_after_initial_validation(self):
        election = _make_election()
        optimistic_token = SimpleNamespace(id=str(uuid4()), used=False)
        locked_token = SimpleNamespace(
            id=optimistic_token.id,
            election_id=election.id,
            used=True,
            expires_at=datetime.now(timezone.utc) + timedelta(hours=1),
        )
        db = SimpleNamespace(
            execute=AsyncMock(
                side_effect=[_scalar_result(election), _scalar_result(locked_token)]
            )
        )

        locked_election, token, error = await ElectionService(
            db
        )._lock_token_ballot_for_submission(election, optimistic_token)

        assert locked_election is None
        assert token is None
        assert error == "This ballot has already been fully submitted"
        assert db.execute.await_count == 2

    async def test_rechecks_election_status_under_lock(self):
        optimistic_election = _make_election()
        locked_election = _make_election(
            id=optimistic_election.id, status=ElectionStatus.CLOSED
        )
        token = SimpleNamespace(
            id=str(uuid4()),
            election_id=locked_election.id,
            used=False,
            expires_at=datetime.now(timezone.utc) + timedelta(hours=1),
        )
        db = SimpleNamespace(
            execute=AsyncMock(
                side_effect=[_scalar_result(locked_election), _scalar_result(token)]
            )
        )

        _, _, error = await ElectionService(db)._lock_token_ballot_for_submission(
            optimistic_election, token
        )

        assert error == "Election is not open for voting"


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
        tie_policy="co_winners",
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
        auto_open=False,
        reminder_hours_before_close=None,
        nomination_deadline=None,
        description=None,
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
        is_manual=False,
        recorded_by=None,
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


def _make_service(signing_key: str = "test-signing-key") -> ElectionService:
    """Create an ElectionService with a mocked DB session and signing key."""
    db = AsyncMock()
    db.add = MagicMock()
    service = ElectionService(db)
    service._get_vote_signing_key = lambda: signing_key  # type: ignore[assignment]
    return service


def _result_returning(scalar=None, scalars_all=None) -> MagicMock:
    """Build a mock DB result for scalar_one_or_none / scalars().all()."""
    result = MagicMock()
    result.scalar_one_or_none.return_value = scalar
    result.scalars.return_value.all.return_value = scalars_all or []
    return result


# ===================================================================
# Finding 1 — concurrent-vote race (PR #1306)
# ===================================================================


class TestCastVoteConcurrencyOrdering:
    async def test_election_lock_precedes_eligibility_reads(self):
        """The FOR UPDATE election read must be the first query cast_vote
        issues — eligibility reads before the lock only ever see the
        REPEATABLE READ snapshot pinned before the competing commit."""
        service = _make_service()
        election = _make_election()
        candidate = SimpleNamespace(
            id=str(uuid4()), accepted=True, is_write_in=False, position=None
        )
        service.db.execute.side_effect = [
            _result_returning(scalar=election),
            _result_returning(scalar=candidate),
        ]
        order = []

        async def eligibility_spy(*args, **kwargs):
            order.append("eligibility")
            return SimpleNamespace(is_eligible=True, reason=None)

        async def votes_spy(*args, **kwargs):
            order.append("duplicate_check")
            return [_make_vote(election.id, candidate_id=candidate.id, position=None)]

        service.check_voter_eligibility = eligibility_spy
        service._get_user_votes = votes_spy

        vote, error = await service.cast_vote(
            user_id=uuid4(),
            election_id=UUID(election.id),
            candidate_id=UUID(candidate.id),
            position=None,
            organization_id=UUID(election.organization_id),
        )

        assert vote is None
        assert error == "You have already voted for this candidate"
        election_query = service.db.execute.await_args_list[0].args[0]
        assert election_query._for_update_arg is not None
        assert order == ["eligibility", "duplicate_check"]

    async def test_duplicate_check_is_locking_read(self):
        """The post-lock duplicate check must pass for_update=True so it
        reads committed current rows, not the transaction snapshot."""
        service = _make_service()
        election = _make_election()
        candidate = SimpleNamespace(
            id=str(uuid4()), accepted=True, is_write_in=False, position=None
        )
        service.db.execute.side_effect = [
            _result_returning(scalar=election),
            _result_returning(scalar=candidate),
        ]
        service.check_voter_eligibility = AsyncMock(
            return_value=SimpleNamespace(is_eligible=True, reason=None)
        )
        service._get_user_votes = AsyncMock(
            return_value=[
                _make_vote(election.id, candidate_id=candidate.id, position=None)
            ]
        )

        vote, error = await service.cast_vote(
            user_id=uuid4(),
            election_id=UUID(election.id),
            candidate_id=UUID(candidate.id),
            position=None,
            organization_id=UUID(election.organization_id),
        )

        assert vote is None
        assert error == "You have already voted for this candidate"
        assert service._get_user_votes.await_args.kwargs.get("for_update") is True

    async def test_get_user_votes_for_update_emits_locking_select(self):
        service = _make_service()
        service.db.execute.return_value = _result_returning(scalars_all=[])

        await service._get_user_votes(uuid4(), uuid4(), None, for_update=True)
        locking_query = service.db.execute.await_args.args[0]
        assert locking_query._for_update_arg is not None

        await service._get_user_votes(uuid4(), uuid4(), None)
        plain_query = service.db.execute.await_args.args[0]
        assert plain_query._for_update_arg is None


# ===================================================================
# Finding 2 — clone copies prospect_package_id (PR #1300)
# ===================================================================


class TestCloneElectionStripsStatefulKeys:
    async def test_clone_strips_prospect_package_id(self):
        service = _make_service()
        source = _make_election(
            ballot_items=[
                {
                    "id": "pkg-item",
                    "type": "membership_approval",
                    "title": "Elect Jane Doe to membership",
                    "vote_type": "approval",
                    "require_attendance": True,
                    "prospect_package_id": "pkg-123",
                },
                {
                    "id": "budget-item",
                    "type": "general_vote",
                    "title": "Approve 2027 budget",
                    "vote_type": "approval",
                },
            ]
        )
        service.get_election = AsyncMock(return_value=source)
        service._audit = AsyncMock()

        clone, error = await service.clone_election(
            election_id=UUID(source.id),
            organization_id=UUID(source.organization_id),
            created_by=str(uuid4()),
            title="Cloned Election",
            start_date=datetime.now(timezone.utc) + timedelta(days=1),
            end_date=datetime.now(timezone.utc) + timedelta(days=2),
        )

        assert error is None
        assert clone is not None
        assert all("prospect_package_id" not in item for item in clone.ballot_items)
        # Configuration keys must survive the strip
        assert clone.ballot_items[0]["title"] == "Elect Jane Doe to membership"
        assert clone.ballot_items[0]["require_attendance"] is True
        # The source's own items must be untouched
        assert source.ballot_items[0]["prospect_package_id"] == "pkg-123"

    async def test_clone_without_ballot_items_still_works(self):
        service = _make_service()
        source = _make_election(ballot_items=None)
        service.get_election = AsyncMock(return_value=source)
        service._audit = AsyncMock()

        clone, error = await service.clone_election(
            election_id=UUID(source.id),
            organization_id=UUID(source.organization_id),
            created_by=str(uuid4()),
            title="Cloned Election",
            start_date=datetime.now(timezone.utc) + timedelta(days=1),
            end_date=datetime.now(timezone.utc) + timedelta(days=2),
        )

        assert error is None
        assert clone is not None
        assert clone.ballot_items is None


# ===================================================================
# Finding 3 — legacy NULL-position votes escape dedup (PR #1305)
# ===================================================================


class TestTokenVoteNullPositionDedup:
    def _token(self, **overrides) -> SimpleNamespace:
        defaults = dict(
            voter_hash="voter-hash-1",
            is_test=False,
            positions_voted=None,
            eligible_positions=None,
            used=False,
            used_at=None,
        )
        defaults.update(overrides)
        return SimpleNamespace(**defaults)

    async def test_legacy_null_position_vote_counts_as_duplicate(self):
        """A pre-normalization vote stored with position NULL must block a
        second counted vote for the same ballot item."""
        service = _make_service()
        election = _make_election(positions=["Chief"])
        token = self._token()
        candidate = SimpleNamespace(
            id=str(uuid4()), accepted=True, is_write_in=False, position="Chief"
        )
        legacy_vote = _make_vote(
            election.id,
            voter_id=None,
            voter_hash=token.voter_hash,
            position=None,
        )
        service.get_ballot_by_token = AsyncMock(return_value=(election, token, None))
        service._lock_token_ballot_for_submission = AsyncMock(
            return_value=(election, token, None)
        )
        service.db.execute.side_effect = [
            _result_returning(scalar=candidate),
            _result_returning(scalars_all=[legacy_vote]),
        ]

        vote, error = await service.cast_vote_with_token(
            token="raw-token",
            candidate_id=UUID(candidate.id),
            position="Chief",
        )

        assert vote is None
        assert error == "You have already voted for Chief"
        # The duplicate lookup must be NULL-aware, scoped to candidates of
        # the same position, so a legacy row cannot slip past the filter.
        votes_query = service.db.execute.await_args_list[1].args[0]
        sql = str(votes_query)
        assert "position IS NULL" in sql
        assert "candidates" in sql

    async def test_positionless_election_matches_null_positions_only(self):
        service = _make_service()
        election = _make_election(positions=None)
        token = self._token()
        candidate = SimpleNamespace(
            id=str(uuid4()), accepted=True, is_write_in=False, position=None
        )
        service.get_ballot_by_token = AsyncMock(return_value=(election, token, None))
        service._lock_token_ballot_for_submission = AsyncMock(
            return_value=(election, token, None)
        )
        service.db.execute.side_effect = [
            _result_returning(scalar=candidate),
            _result_returning(scalars_all=[]),
        ]
        service._audit = AsyncMock()

        vote, error = await service.cast_vote_with_token(
            token="raw-token",
            candidate_id=UUID(candidate.id),
            position=None,
        )

        assert error is None
        assert vote is not None
        votes_query = service.db.execute.await_args_list[1].args[0]
        assert "position IS NULL" in str(votes_query)

    async def test_omitted_position_books_effective_position(self):
        """positions_voted must record the effective position (falling back
        to candidate.position) so an omitted position field cannot leave the
        token forever reusable for that position."""
        service = _make_service()
        election = _make_election(positions=["Chief"])
        token = self._token()
        candidate = SimpleNamespace(
            id=str(uuid4()), accepted=True, is_write_in=False, position="Chief"
        )
        service.get_ballot_by_token = AsyncMock(return_value=(election, token, None))
        service._lock_token_ballot_for_submission = AsyncMock(
            return_value=(election, token, None)
        )
        service.db.execute.side_effect = [
            _result_returning(scalar=candidate),
            _result_returning(scalars_all=[]),
        ]
        service._audit = AsyncMock()

        vote, error = await service.cast_vote_with_token(
            token="raw-token",
            candidate_id=UUID(candidate.id),
            position=None,
        )

        assert error is None
        assert vote is not None
        assert token.positions_voted == ["Chief"]
        # All eligible positions covered — the token must be spent
        assert token.used is True
        assert token.used_at is not None


# ===================================================================
# Finding 4 — paper multi-vote turnout (PR #1341)
# ===================================================================


class TestCountBallotsCast:
    def _manual_votes(self, election_id: str) -> list:
        """Ten paper ballots for one position split 5/5 across two candidates."""
        cand_a, cand_b = str(uuid4()), str(uuid4())
        votes = []
        for cand in (cand_a, cand_b):
            votes.extend(
                _make_vote(
                    election_id,
                    voter_id=None,
                    candidate_id=cand,
                    position="Chief",
                    is_manual=True,
                )
                for _ in range(5)
            )
        return votes

    def test_single_choice_election_uses_position_sums(self):
        election = _make_election(
            voting_method="simple_majority",
            max_votes_per_position=1,
            ballot_items=[
                # No override — inherits the single-choice election method
                {"id": "chief", "type": "officer_election", "title": "Chief"}
            ],
        )
        votes = self._manual_votes(election.id)
        assert ElectionService._count_ballots_cast(election, votes) == 10

    def test_item_level_approval_override_uses_candidate_max(self):
        """A single-choice election whose ballot item overrides to a
        multi-vote method must not treat per-candidate tallies as distinct
        voters — position sums would double-count one ballot's selections."""
        election = _make_election(
            voting_method="simple_majority",
            max_votes_per_position=1,
            ballot_items=[
                {
                    "id": "chief",
                    "type": "officer_election",
                    "title": "Chief",
                    "voting_method": "approval",
                }
            ],
        )
        votes = self._manual_votes(election.id)
        assert ElectionService._count_ballots_cast(election, votes) == 5

    def test_election_level_approval_uses_candidate_max(self):
        election = _make_election(voting_method="approval")
        votes = self._manual_votes(election.id)
        assert ElectionService._count_ballots_cast(election, votes) == 5

    def test_multi_votes_per_position_uses_candidate_max(self):
        election = _make_election(
            voting_method="simple_majority", max_votes_per_position=2
        )
        votes = self._manual_votes(election.id)
        assert ElectionService._count_ballots_cast(election, votes) == 5

    def test_electronic_voters_deduplicated_and_added_to_paper(self):
        election = _make_election(voting_method="simple_majority")
        votes = self._manual_votes(election.id)
        # One electronic voter casting for two positions is still one voter
        voter_hash = "electronic-voter"
        votes.append(
            _make_vote(
                election.id,
                voter_id=None,
                voter_hash=voter_hash,
                position="Chief",
            )
        )
        votes.append(
            _make_vote(
                election.id,
                voter_id=None,
                voter_hash=voter_hash,
                position="President",
            )
        )
        assert ElectionService._count_ballots_cast(election, votes) == 11


# ===================================================================
# Finding 5 — mixed naive/aware datetimes must be a 422, not a 500
# (PRs #1300/#1301)
# ===================================================================


class TestMixedDatetimeFormsAreValidationErrors:
    """Pydantic v2 accepts both '2026-01-01T00:00:00' and
    '2026-01-01T00:00:00Z'; comparing the two raises TypeError, which a
    model_validator does NOT convert to a validation error. The schemas
    now normalize naive datetimes to UTC before any comparison."""

    NAIVE = datetime(2026, 9, 1, 12, 0, 0)
    AWARE = datetime(2026, 9, 3, 12, 0, 0, tzinfo=timezone.utc)

    def test_create_with_naive_start_and_aware_end_validates(self):
        election = ElectionCreate(
            title="Mixed tz", start_date=self.NAIVE, end_date=self.AWARE
        )
        assert election.start_date.tzinfo is not None
        assert election.end_date.tzinfo is not None

    def test_create_mixed_forms_invalid_order_is_validation_error(self):
        # end before start, expressed as aware-end + naive-start: must be a
        # ValidationError (422 at the API boundary), never a bare TypeError.
        with pytest.raises(ValidationError):
            ElectionCreate(
                title="Mixed tz",
                start_date=self.AWARE,
                end_date=self.NAIVE - timedelta(days=30),
            )

    def test_create_normalizes_naive_as_utc(self):
        election = ElectionCreate(
            title="Naive",
            start_date=self.NAIVE,
            end_date=self.NAIVE + timedelta(days=1),
        )
        assert election.start_date == self.NAIVE.replace(tzinfo=timezone.utc)

    def test_update_normalizes_all_datetime_fields(self):
        update = ElectionUpdate(
            start_date=self.NAIVE,
            end_date=self.AWARE,
            meeting_date=self.NAIVE,
            nomination_deadline=self.NAIVE,
        )
        for field in ("start_date", "end_date", "meeting_date", "nomination_deadline"):
            assert getattr(update, field).tzinfo is not None, field

    def test_clone_request_mixed_forms_is_validation_error(self):
        # CloneElectionRequest.validate_dates had the identical comparison bug.
        with pytest.raises(ValidationError):
            CloneElectionRequest(
                title="Clone",
                start_date=self.AWARE,
                end_date=self.NAIVE - timedelta(days=30),
            )

    def test_clone_request_mixed_forms_valid_order_passes(self):
        clone = CloneElectionRequest(
            title="Clone", start_date=self.NAIVE, end_date=self.AWARE
        )
        assert clone.start_date.tzinfo is not None


# ===================================================================
# Finding 6 — strict ballot-item id pattern is input-only
# (PRs #1300/#1301)
# ===================================================================

LEGACY_ITEM = {
    "id": "Approve 2019 budget (item #1)",  # spaces + punctuation
    "type": "general_vote",
    "title": "Approve 2019 budget",
    "vote_type": "approval",
}


class TestBallotItemIdStrictnessIsInputOnly:
    def test_response_model_accepts_legacy_id(self):
        # Stored JSON from pre-pattern rows deserializes through BallotItem
        # in every response schema; a strict pattern there is a 500 on GET.
        item = BallotItem.model_validate(LEGACY_ITEM)
        assert item.id == LEGACY_ITEM["id"]

    def test_response_model_accepts_legacy_supermajority_without_percentage(self):
        # Same class of bug: the supermajority-requires-percentage rule can
        # only be demanded of new payloads, not of already-stored items.
        item = BallotItem.model_validate(
            {**LEGACY_ITEM, "victory_condition": "supermajority"}
        )
        assert item.victory_percentage is None

    def test_election_response_serializes_legacy_ballot_items(self):
        election = _make_election(
            ballot_items=[LEGACY_ITEM],
            email_sent=False,
            email_sent_at=None,
            email_recipients=None,
            meeting_date=None,
            meeting_id=None,
            event_id=None,
        )
        response = ElectionResponse.model_validate(election)
        assert response.ballot_items is not None
        assert response.ballot_items[0].id == LEGACY_ITEM["id"]

    def test_create_rejects_legacy_id(self):
        with pytest.raises(ValidationError, match="pattern"):
            ElectionCreate(
                title="Strict input",
                start_date=datetime(2026, 9, 1, tzinfo=timezone.utc),
                end_date=datetime(2026, 9, 2, tzinfo=timezone.utc),
                ballot_items=[LEGACY_ITEM],
            )

    def test_update_rejects_legacy_id(self):
        with pytest.raises(ValidationError, match="pattern"):
            ElectionUpdate(ballot_items=[LEGACY_ITEM])

    def test_saved_template_rejects_legacy_id(self):
        with pytest.raises(ValidationError, match="pattern"):
            SavedBallotTemplateCreate(name="Legacy", ballot_items=[LEGACY_ITEM])

    def test_saved_template_rejects_unknown_voting_method(self):
        with pytest.raises(ValidationError, match="voting method"):
            SavedBallotTemplateCreate(
                name="Unsupported method",
                ballot_items=[{**LEGACY_ITEM, "id": "budget-2026"}],
                voting_method="plurality_plus",
            )

    def test_input_still_requires_supermajority_percentage(self):
        item = {
            "id": "budget-2026",
            "type": "general_vote",
            "title": "Approve 2026 budget",
            "vote_type": "approval",
            "victory_condition": "supermajority",
        }
        with pytest.raises(ValidationError, match="victory_percentage"):
            ElectionUpdate(ballot_items=[item])
        # With the percentage the same item is accepted.
        update = ElectionUpdate(ballot_items=[{**item, "victory_percentage": 67}])
        assert update.ballot_items[0].victory_percentage == 67


# ===================================================================
# Finding 7 — quorum validity check must not brick legacy rows
# (PR #1301)
# ===================================================================


@pytest.mark.integration
class TestQuorumCheckOnlyWhenTouched:
    """Pre-existing rows can hold quorum_type != 'none' with quorum_value
    NULL. The effective-quorum check on PATCH must only run when the update
    touches quorum fields — otherwise even a title-only PATCH 400s and the
    election can never be edited (or repaired) again."""

    @pytest.fixture
    async def legacy_quorum_election(self, db_session):
        org_id = str(uuid_module.uuid4())
        user_id = str(uuid_module.uuid4())
        election_id = str(uuid_module.uuid4())
        await db_session.execute(
            text(
                "INSERT INTO organizations (id, name, organization_type, slug, timezone) "
                "VALUES (:id, :name, 'fire_department', :slug, 'UTC')"
            ),
            {"id": org_id, "name": "Legacy Quorum FD", "slug": f"lq-{org_id[:8]}"},
        )
        await db_session.execute(
            text(
                "INSERT INTO users "
                "(id, organization_id, username, first_name, last_name, "
                "email, password_hash, status) "
                "VALUES (:id, :org, :un, 'Quinn', 'Quorum', :em, 'hashed', 'active')"
            ),
            {
                "id": user_id,
                "org": org_id,
                "un": f"lq-admin-{user_id[:8]}",
                "em": f"lq-admin-{user_id[:8]}@test.com",
            },
        )
        now = datetime.now(timezone.utc)
        await db_session.execute(
            text(
                "INSERT INTO elections "
                "(id, organization_id, title, election_type, "
                "start_date, end_date, status, anonymous_voting, "
                "allow_write_ins, max_votes_per_position, voting_method, "
                "victory_condition, voter_anonymity_salt, "
                "quorum_type, quorum_value, "
                "created_by, email_sent, results_visible_immediately, "
                "enable_runoffs, runoff_type, max_runoff_rounds, "
                "is_runoff, runoff_round, auto_open, created_at, updated_at) "
                "VALUES (:id, :org, 'Legacy Quorum Election', 'general', "
                ":start, :end, 'draft', 1, 0, 1, 'simple_majority', "
                "'most_votes', :salt, "
                "'percentage', NULL, "  # the legacy shape under test
                ":creator, 0, 0, 0, 'top_two', 3, 0, 0, 0, NOW(), NOW())"
            ),
            {
                "id": election_id,
                "org": org_id,
                "start": now + timedelta(days=1),
                "end": now + timedelta(days=2),
                "salt": secrets.token_hex(32),
                "creator": user_id,
            },
        )
        await db_session.flush()
        return org_id, user_id, election_id

    async def test_title_only_patch_succeeds_on_legacy_quorum_row(
        self, db_session, legacy_quorum_election
    ):
        from app.api.v1.endpoints.elections import update_election

        org_id, user_id, election_id = legacy_quorum_election
        response = await update_election(
            election_id=UUID(election_id),
            election_update=ElectionUpdate(title="Renamed Legacy Election"),
            db=db_session,
            current_user=SimpleNamespace(id=user_id, organization_id=org_id),
        )
        assert response.title == "Renamed Legacy Election"
        # The stored (invalid) quorum config is left alone, not "repaired".
        assert response.quorum_type == "percentage"
        assert response.quorum_value is None

    async def test_patch_touching_quorum_still_enforced(
        self, db_session, legacy_quorum_election
    ):
        from fastapi import HTTPException

        from app.api.v1.endpoints.elections import update_election

        org_id, user_id, election_id = legacy_quorum_election
        with pytest.raises(HTTPException) as exc_info:
            await update_election(
                election_id=UUID(election_id),
                election_update=ElectionUpdate(quorum_type="count"),
                db=db_session,
                current_user=SimpleNamespace(id=user_id, organization_id=org_id),
            )
        assert exc_info.value.status_code == 400
        assert "quorum_value" in exc_info.value.detail

    async def test_patch_can_repair_legacy_quorum_row(
        self, db_session, legacy_quorum_election
    ):
        from app.api.v1.endpoints.elections import update_election

        org_id, user_id, election_id = legacy_quorum_election
        response = await update_election(
            election_id=UUID(election_id),
            election_update=ElectionUpdate(quorum_type="percentage", quorum_value=50),
            db=db_session,
            current_user=SimpleNamespace(id=user_id, organization_id=org_id),
        )
        assert response.quorum_type == "percentage"
        assert response.quorum_value == 50
