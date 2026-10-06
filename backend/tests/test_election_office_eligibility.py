"""A membership tier that cannot hold office keeps its members off the ballot.

``MembershipTierBenefits.can_hold_office`` shipped as a stored, editable
setting that nothing read (TIER-OFFICE, CLAUDE.md pitfall 19): a probationary
member could be nominated and elected with the box cleared. The nomination and
acceptance paths now read it. A department with no stored tiers keeps
today's behaviour.
"""

import json
import uuid

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.election_service import ElectionService, _tier_benefits
from tests.test_election_nominations import TestNominationSetup

pytestmark = [pytest.mark.integration]


_TIERS = {
    "membership_tiers": {
        "tiers": [
            {"id": "active", "benefits": {"can_hold_office": True}},
            {"id": "probationary", "benefits": {"can_hold_office": False}},
        ]
    }
}


class TestTierBenefitsReader:
    @pytest.mark.unit
    def test_missing_or_malformed_tiers_read_as_no_benefits(self):
        from types import SimpleNamespace

        member = SimpleNamespace(membership_type="probationary")
        assert _tier_benefits(member, None) == {}
        assert _tier_benefits(member, SimpleNamespace(settings={})) == {}
        assert (
            _tier_benefits(
                member, SimpleNamespace(settings={"membership_tiers": "nonsense"})
            )
            == {}
        )


class TestOfficeEligibility(TestNominationSetup):
    async def _with_tiers(self, db_session, org_id, probationary_id):
        await db_session.execute(
            text("UPDATE organizations SET settings = :s WHERE id = :o"),
            {"s": json.dumps(_TIERS), "o": org_id},
        )
        await db_session.execute(
            text("UPDATE users SET membership_type = 'probationary' WHERE id = :u"),
            {"u": probationary_id},
        )
        await db_session.flush()
        db_session.expire_all()

    async def _open(self, db_session, org_id, creator):
        election_id = await self._insert_election(db_session, org_id, creator)
        svc = ElectionService(db_session)
        await svc.open_nominations(uuid.UUID(election_id), uuid.UUID(org_id))
        return svc, election_id

    async def test_a_tier_that_cannot_hold_office_is_refused(
        self, db_session: AsyncSession, setup_org_and_users
    ):
        org_id, user1_id, user2_id = setup_org_and_users
        await self._with_tiers(db_session, org_id, user2_id)
        svc, election_id = await self._open(db_session, org_id, user1_id)

        candidate, err = await svc.create_nomination(
            election_id=uuid.UUID(election_id),
            organization_id=uuid.UUID(org_id),
            nominator_id=user1_id,
            position="Chief",
            nominee_user_id=user2_id,
        )

        assert candidate is None
        assert "cannot hold elected office" in err

    async def test_an_eligible_tier_can_be_nominated(
        self, db_session: AsyncSession, setup_org_and_users
    ):
        org_id, user1_id, user2_id = setup_org_and_users
        await self._with_tiers(db_session, org_id, user2_id)
        svc, election_id = await self._open(db_session, org_id, user1_id)

        candidate, err = await svc.create_nomination(
            election_id=uuid.UUID(election_id),
            organization_id=uuid.UUID(org_id),
            nominator_id=user2_id,
            position="Chief",
            nominee_user_id=user1_id,
        )

        assert err is None
        assert candidate.user_id == user1_id

    async def test_no_stored_tiers_keeps_todays_behaviour(
        self, db_session: AsyncSession, setup_org_and_users
    ):
        org_id, user1_id, user2_id = setup_org_and_users
        await db_session.execute(
            text("UPDATE users SET membership_type = 'probationary' WHERE id = :u"),
            {"u": user2_id},
        )
        await db_session.flush()
        svc, election_id = await self._open(db_session, org_id, user1_id)

        candidate, err = await svc.create_nomination(
            election_id=uuid.UUID(election_id),
            organization_id=uuid.UUID(org_id),
            nominator_id=user1_id,
            position="Chief",
            nominee_user_id=user2_id,
        )

        assert err is None
        assert candidate is not None

    async def test_acceptance_rechecks_the_tier(
        self, db_session: AsyncSession, setup_org_and_users
    ):
        org_id, user1_id, user2_id = setup_org_and_users
        svc, election_id = await self._open(db_session, org_id, user1_id)
        candidate, err = await svc.create_nomination(
            election_id=uuid.UUID(election_id),
            organization_id=uuid.UUID(org_id),
            nominator_id=user1_id,
            position="Chief",
            nominee_user_id=user2_id,
        )
        assert err is None
        candidate_id = candidate.id
        # Moved to a tier that cannot hold office before accepting.
        await self._with_tiers(db_session, org_id, user2_id)

        ok, err = await svc.respond_to_nomination(
            election_id=uuid.UUID(election_id),
            organization_id=uuid.UUID(org_id),
            candidate_id=uuid.UUID(candidate_id),
            user_id=user2_id,
            accept=True,
        )

        assert ok is False
        assert "cannot hold elected office" in err


class TestOfficerCandidatePath:
    """An officer adding a member as a candidate meets the same rule."""

    @pytest.mark.unit
    async def test_an_ineligible_member_is_refused_and_a_write_in_is_not_checked(
        self,
    ):
        from types import SimpleNamespace
        from unittest.mock import AsyncMock, MagicMock

        from fastapi import HTTPException

        from app.api.v1.endpoints.elections import _assert_can_hold_office

        member = SimpleNamespace(full_name="Pat Probie")
        result = MagicMock()
        result.scalar_one_or_none.return_value = member
        service = SimpleNamespace(
            db=SimpleNamespace(execute=AsyncMock(return_value=result)),
            member_can_hold_office=AsyncMock(return_value=False),
        )
        officer = SimpleNamespace(organization_id="org-1")

        with pytest.raises(HTTPException) as exc:
            await _assert_can_hold_office(service, "u-1", officer)
        assert exc.value.status_code == 400
        assert "Pat Probie" in exc.value.detail

        await _assert_can_hold_office(service, None, officer)
        service.db.execute.assert_awaited_once()
