"""
Elections — regression tests for the round-2 Codex review on PR #2162
(pass 3's "0 fixes, 0 new findings" re-verification).

Covers the findings confirmed real against current code:

1. `_user_has_role_type` no longer inherits a stale operational/regular
   `member_class`/`member_status` carried over (by `_reconcile_membership`,
   `models/user.py`, for shift-eligibility reasons) from before a member was
   moved onto an org-configured custom membership tier. A custom tier must
   still match no built-in voter category for election eligibility.
3. `attest_manual_ballot_batch` takes a locking read on the election row,
   not just the batch, so it cannot observe a stale OPEN status past a
   concurrent close.
5. `_lock_token_ballot_for_submission`'s re-selects use
   `populate_existing=True` so the lock actually refreshes the cached
   election/token state `get_ballot_by_token` already loaded.
6. `void_manual_ballot_batch` locks the batch (and the votes) `FOR UPDATE`
   and refuses a second void of an already-voided batch, instead of two
   concurrent voids racing to overwrite each other's attribution.
7. `submit_ballot_with_token`'s plain-candidate-UUID `choice` branch checks
   `candidate.position == position`, matching the rankings/candidate_ids
   branches, so a candidate from one ballot item cannot be bound onto
   another item.
8. `cast_vote_with_token` enforces the token's `eligible_item_ids` snapshot
   for ballot-item elections, not just `eligible_positions` (which is always
   None for them) — closing the reintroduced R-1 bypass on the single-vote
   route.

Findings 2 (receipt hash in a GET query param) and 4 (unbounded manual-ballot
batch listing) were confirmed as real but flagged rather than fixed — see
`docs/security-review/ELEC-06-elections-ballots.md` for the disposition and
rationale; no regression test applies to a flagged, unchanged code path.
"""

import secrets
import uuid
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock
from uuid import UUID, uuid4

import pytest
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.election import ElectionStatus
from app.services.election_service import ElectionService


def _uid() -> str:
    return str(uuid.uuid4())


def _scalar_result(value):
    result = MagicMock()
    result.scalar_one_or_none.return_value = value
    return result


def _count_result(value: int):
    result = MagicMock()
    result.scalar.return_value = value
    return result


def _result_returning(scalar=None, scalars_all=None) -> MagicMock:
    result = MagicMock()
    result.scalar_one_or_none.return_value = scalar
    result.scalars.return_value.all.return_value = scalars_all or []
    return result


def _make_service() -> ElectionService:
    db = AsyncMock()
    db.add = MagicMock()
    return ElectionService(db)


# ===================================================================
# Finding 1 — custom membership tier must not inherit a stale
# operational/regular class for election eligibility
# ===================================================================


class TestCustomTierDoesNotInheritStaleEligibility:
    async def test_custom_tier_with_preserved_operational_class_is_ineligible(self):
        """`_reconcile_membership` deliberately preserves member_class /
        member_status from before a switch onto an org-configured custom
        tier (e.g. "senior") so shift eligibility still recognizes a member
        who rides. Election eligibility must not inherit that carryover: a
        custom tier is documented (split_membership_type's own docstring)
        to match no built-in voter category."""
        service = _make_service()
        user = SimpleNamespace(
            member_class="operational",
            member_status="regular",
            membership_type="senior",  # live value is the unrecognized tier
            roles=[],
        )

        assert not await service._user_has_role_type(user, ["operational"])
        assert not await service._user_has_role_type(user, ["regular"])

    async def test_recognized_legacy_membership_type_is_unaffected(self):
        """A member whose membership_type is one of the seven known legacy
        values must keep matching its category exactly as before — the fix
        only discards class/status for an *unrecognized* live tier."""
        service = _make_service()
        user = SimpleNamespace(
            member_class="operational",
            member_status="regular",
            membership_type="active",
            roles=[],
        )

        assert await service._user_has_role_type(user, ["operational"])

    async def test_stub_with_no_membership_type_still_falls_back_to_columns(self):
        """Callers passing a bare class/status stub (no membership_type at
        all, as most existing unit tests do) must be unaffected."""
        service = _make_service()
        user = SimpleNamespace(
            member_class="operational", member_status="regular", roles=[]
        )

        assert await service._user_has_role_type(user, ["operational"])


# ===================================================================
# Finding 3 — attestation must take a locking read on the election,
# not just the batch, to serialize with a concurrent close
# ===================================================================


class TestAttestationLocksElection:
    async def test_election_read_is_locking(self):
        service = _make_service()
        batch = SimpleNamespace(
            id="batch-1",
            status="pending",
            recorded_by="recorder-1",
            required_attestations=2,
        )
        election = SimpleNamespace(id="election-1", status=ElectionStatus.OPEN)
        service.db.execute.side_effect = [
            _scalar_result(batch),
            _scalar_result(election),
            _count_result(0),
            _count_result(1),
        ]
        service._audit = AsyncMock()

        result, error = await service.attest_manual_ballot_batch(
            election_id=UUID(int=0),
            organization_id=UUID(int=0),
            batch_id="batch-1",
            attested_by="attester-1",
        )

        assert error is None
        election_query = service.db.execute.await_args_list[1].args[0]
        assert election_query._for_update_arg is not None
        # Sanity: it is actually the Election query, not the batch one again.
        assert "elections" in str(election_query).lower()


# ===================================================================
# Finding 5 — the token-submission lock must repopulate the already
# loaded election/token instances, not just acquire the row lock
# ===================================================================


class TestTokenLockRepopulatesExisting:
    async def _make_election(self, **overrides) -> SimpleNamespace:
        defaults = dict(
            id=str(uuid4()),
            status=ElectionStatus.OPEN,
            start_date=datetime.now(timezone.utc) - timedelta(days=1),
            end_date=datetime.now(timezone.utc) + timedelta(days=1),
        )
        defaults.update(overrides)
        return SimpleNamespace(**defaults)

    async def test_election_and_token_reselects_use_populate_existing(self):
        service = _make_service()
        election = SimpleNamespace(
            id=str(uuid4()),
            status=ElectionStatus.OPEN,
            start_date=datetime.now(timezone.utc) - timedelta(days=1),
            end_date=datetime.now(timezone.utc) + timedelta(days=1),
        )
        token = SimpleNamespace(
            id=str(uuid4()),
            election_id=election.id,
            used=False,
            expires_at=datetime.now(timezone.utc) + timedelta(hours=1),
        )
        service.db.execute.side_effect = [
            _scalar_result(election),
            _scalar_result(token),
        ]

        locked_election, locked_token, error = (
            await service._lock_token_ballot_for_submission(election, token)
        )

        assert error is None
        election_query = service.db.execute.await_args_list[0].args[0]
        token_query = service.db.execute.await_args_list[1].args[0]
        assert election_query._for_update_arg is not None
        assert token_query._for_update_arg is not None
        assert election_query.get_execution_options().get("populate_existing") is True
        assert token_query.get_execution_options().get("populate_existing") is True


# ===================================================================
# Finding 6 — void_manual_ballot_batch must lock the batch (and votes)
# and refuse a second void of an already-voided batch
# ===================================================================


class TestVoidManualBallotBatchLocking:
    async def test_batch_and_votes_selects_are_locking(self):
        service = _make_service()
        batch = SimpleNamespace(id="batch-1", status="pending")
        vote = SimpleNamespace(
            id="vote-1",
            deleted_at=None,
            deleted_by=None,
            deletion_reason=None,
        )
        service.db.execute.side_effect = [
            _scalar_result(batch),
            _result_returning(scalars_all=[vote]),
        ]
        service._audit = AsyncMock()

        count, error = await service.void_manual_ballot_batch(
            election_id=UUID(int=0),
            organization_id=UUID(int=0),
            batch_id="batch-1",
            deleted_by="officer-1",
            reason="mis-keyed",
        )

        assert error is None
        assert count == 1
        batch_query = service.db.execute.await_args_list[0].args[0]
        votes_query = service.db.execute.await_args_list[1].args[0]
        assert batch_query._for_update_arg is not None
        assert votes_query._for_update_arg is not None
        assert batch.status == "voided"

    async def test_already_voided_batch_is_refused_without_touching_votes(self):
        """The locked batch read must short-circuit a second void attempt —
        this is what actually closes the race: two concurrent voids
        serialize on the batch lock, and the loser sees status='voided'
        already committed instead of re-processing the same votes."""
        service = _make_service()
        batch = SimpleNamespace(id="batch-1", status="voided")
        service.db.execute.side_effect = [_scalar_result(batch)]

        count, error = await service.void_manual_ballot_batch(
            election_id=UUID(int=0),
            organization_id=UUID(int=0),
            batch_id="batch-1",
            deleted_by="officer-2",
            reason="duplicate attempt",
        )

        assert count == 0
        assert error == "This batch has already been voided"
        assert service.db.execute.await_count == 1


# ===================================================================
# Findings 7 & 8 — token-path ballot integrity (real DB, exercises the
# actual submit_ballot_with_token / cast_vote_with_token code paths)
# ===================================================================


async def _setup_two_item_election(db_session: AsyncSession) -> dict:
    """One OPEN election with two ballot items (item_a, item_b), each with
    one accepted candidate stored under the item's own position."""
    org_id, user_id, election_id = _uid(), _uid(), _uid()
    cand_a_id, cand_b_id = _uid(), _uid()
    salt = secrets.token_hex(32)
    now = datetime.now(timezone.utc)

    await db_session.execute(
        text(
            "INSERT INTO organizations (id, name, organization_type, slug, timezone) "
            "VALUES (:id, :name, 'fire_department', :slug, 'UTC')"
        ),
        {"id": org_id, "name": "Round2 FD", "slug": f"r2-{org_id[:8]}"},
    )
    await db_session.execute(
        text(
            "INSERT INTO users "
            "(id, organization_id, username, first_name, last_name, "
            "email, password_hash, status) "
            "VALUES (:id, :org, :un, 'Voter', 'Two', :em, 'hashed', 'active')"
        ),
        {
            "id": user_id,
            "org": org_id,
            "un": f"r2-voter-{user_id[:8]}",
            "em": f"r2-voter-{user_id[:8]}@test.com",
        },
    )
    ballot_items = (
        '[{"id": "item_a", "type": "officer_election", "title": "Item A", '
        '"eligible_voter_types": ["all"]}, '
        '{"id": "item_b", "type": "officer_election", "title": "Item B", '
        '"eligible_voter_types": ["all"]}]'
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
            "VALUES (:id, :org, 'Two Item Election', 'general', :items, "
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
    for cand_id, pos, name in (
        (cand_a_id, "item_a", "Candidate A"),
        (cand_b_id, "item_b", "Candidate B"),
    ):
        await db_session.execute(
            text(
                "INSERT INTO candidates "
                "(id, election_id, name, position, accepted, is_write_in, "
                "display_order, nomination_date, created_at, updated_at) "
                "VALUES (:id, :eid, :name, :pos, 1, 0, 0, NOW(), NOW(), NOW())"
            ),
            {"id": cand_id, "eid": election_id, "name": name, "pos": pos},
        )
    await db_session.flush()
    return {
        "org_id": org_id,
        "user_id": user_id,
        "election_id": election_id,
        "candidate_a_id": cand_a_id,
        "candidate_b_id": cand_b_id,
        "salt": salt,
    }


@pytest.mark.integration
class TestSubmitBallotChoiceBoundToItem:
    async def test_candidate_from_item_a_cannot_be_bound_to_item_b(
        self, db_session: AsyncSession
    ):
        """The plain candidate-UUID `choice` form must be rejected when the
        candidate does not belong to the named ballot item — otherwise it
        is stored under that item's position regardless (ballot-integrity
        bypass)."""
        data = await _setup_two_item_election(db_session)
        svc = ElectionService(db_session)
        token, raw_token = await svc._generate_voting_token(
            user_id=uuid.UUID(data["user_id"]),
            election_id=uuid.UUID(data["election_id"]),
            organization_id=uuid.UUID(data["org_id"]),
            election_end_date=datetime.now(timezone.utc) + timedelta(days=1),
            anonymity_salt=data["salt"],
        )
        await db_session.flush()

        result, error = await svc.submit_ballot_with_token(
            token=raw_token,
            votes=[
                {
                    "ballot_item_id": "item_b",
                    "choice": data["candidate_a_id"],  # belongs to item_a
                }
            ],
        )

        assert result is None
        assert error is not None
        assert "Invalid candidate selection" in error

        from app.models.election import Vote

        stored = (
            (
                await db_session.execute(
                    select(Vote).where(Vote.election_id == data["election_id"])
                )
            )
            .scalars()
            .all()
        )
        assert stored == [], "No vote should be persisted for the crafted binding"

    async def test_candidate_matching_its_own_item_still_succeeds(
        self, db_session: AsyncSession
    ):
        data = await _setup_two_item_election(db_session)
        svc = ElectionService(db_session)
        token, raw_token = await svc._generate_voting_token(
            user_id=uuid.UUID(data["user_id"]),
            election_id=uuid.UUID(data["election_id"]),
            organization_id=uuid.UUID(data["org_id"]),
            election_end_date=datetime.now(timezone.utc) + timedelta(days=1),
            anonymity_salt=data["salt"],
        )
        await db_session.flush()

        result, error = await svc.submit_ballot_with_token(
            token=raw_token,
            votes=[
                {"ballot_item_id": "item_a", "choice": data["candidate_a_id"]},
                {"ballot_item_id": "item_b", "choice": data["candidate_b_id"]},
            ],
        )

        assert error is None, f"Legitimate matched submission rejected: {error}"
        assert result["votes_cast"] == 2


@pytest.mark.integration
class TestSingleVoteTokenEnforcesItemEligibility:
    async def test_token_scoped_to_item_a_cannot_vote_on_item_b(
        self, db_session: AsyncSession
    ):
        """cast_vote_with_token (the single-vote /ballot/vote route) must
        honor the token's eligible_item_ids snapshot for ballot-item
        elections — eligible_positions is always None for them, so without
        this check the restriction was a no-op (the reintroduced R-1
        bypass)."""
        data = await _setup_two_item_election(db_session)
        svc = ElectionService(db_session)
        token, raw_token = await svc._generate_voting_token(
            user_id=uuid.UUID(data["user_id"]),
            election_id=uuid.UUID(data["election_id"]),
            organization_id=uuid.UUID(data["org_id"]),
            election_end_date=datetime.now(timezone.utc) + timedelta(days=1),
            anonymity_salt=data["salt"],
            eligible_item_ids=["item_a"],
        )
        await db_session.flush()

        vote, error = await svc.cast_vote_with_token(
            token=raw_token,
            candidate_id=uuid.UUID(data["candidate_b_id"]),
            position=None,
        )

        assert vote is None
        assert error is not None
        assert "not eligible" in error

    async def test_token_scoped_to_item_a_can_still_vote_on_item_a(
        self, db_session: AsyncSession
    ):
        data = await _setup_two_item_election(db_session)
        svc = ElectionService(db_session)
        token, raw_token = await svc._generate_voting_token(
            user_id=uuid.UUID(data["user_id"]),
            election_id=uuid.UUID(data["election_id"]),
            organization_id=uuid.UUID(data["org_id"]),
            election_end_date=datetime.now(timezone.utc) + timedelta(days=1),
            anonymity_salt=data["salt"],
            eligible_item_ids=["item_a"],
        )
        await db_session.flush()

        vote, error = await svc.cast_vote_with_token(
            token=raw_token,
            candidate_id=uuid.UUID(data["candidate_a_id"]),
            position=None,
        )

        assert error is None, f"Eligible item vote wrongly rejected: {error}"
        assert vote is not None
        assert vote.position == "item_a"

    async def test_unrestricted_token_is_unaffected(self, db_session: AsyncSession):
        """eligible_item_ids=None (legacy token / unrestricted) must remain
        unrestricted — the new check only applies when the token snapshot
        actually names a subset of items."""
        data = await _setup_two_item_election(db_session)
        svc = ElectionService(db_session)
        token, raw_token = await svc._generate_voting_token(
            user_id=uuid.UUID(data["user_id"]),
            election_id=uuid.UUID(data["election_id"]),
            organization_id=uuid.UUID(data["org_id"]),
            election_end_date=datetime.now(timezone.utc) + timedelta(days=1),
            anonymity_salt=data["salt"],
        )
        await db_session.flush()

        vote, error = await svc.cast_vote_with_token(
            token=raw_token,
            candidate_id=uuid.UUID(data["candidate_b_id"]),
            position=None,
        )

        assert error is None, f"Unrestricted token wrongly rejected: {error}"
        assert vote is not None
