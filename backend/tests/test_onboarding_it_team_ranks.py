"""A rank chosen for an IT contact during setup reaches their account.

IT contacts are collected at step 10 and only become user accounts at
completion, so the rank picked for one has to travel through the onboarding
session and be applied when the account is created.

The interesting case is the one in between. The rank ladder is edited at step
11, *after* the contacts are named, so a department can pick a rank here and
then remove it from its own ladder before finishing. That must not be able to
fail the whole of setup at the final Continue over an optional field — but
neither may it store a code that resolves to nothing, which is a member with no
seats, no permissions, and nothing anywhere saying why.
"""

import uuid

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import User
from app.services.onboarding import OnboardingService
from app.services.operational_rank_service import OperationalRankService

pytestmark = [pytest.mark.integration, pytest.mark.onboarding]


async def _org(db_session: AsyncSession):
    service = OnboardingService(db_session)
    unique = str(uuid.uuid4())[:8]
    org = await service.create_organization(
        name=f"Rank Test Department {unique}",
        slug=f"rank-test-{unique}",
        organization_type="fire_department",
        timezone="America/New_York",
    )
    await db_session.flush()
    return service, org


def _contact(rank: str | None = None) -> dict:
    unique = str(uuid.uuid4())[:8]
    member = {
        "name": "Dana Reyes",
        "email": f"dana-{unique}@example.com",
        "phone": "555-0101",
        "role": "IT Support",
    }
    if rank is not None:
        member["rank"] = rank
    return member


async def _rank_of(db_session: AsyncSession, email: str) -> str | None:
    user = (
        await db_session.execute(select(User).where(User.email == email))
    ).scalar_one()
    return user.rank


class TestItTeamRanks:
    async def test_a_chosen_rank_lands_on_the_created_account(
        self, db_session: AsyncSession
    ):
        service, org = await _org(db_session)
        await OperationalRankService(db_session).seed_defaults(str(org.id))
        contact = _contact("captain")

        created = await service.create_it_team_users(str(org.id), [contact])

        assert len(created) == 1
        assert await _rank_of(db_session, contact["email"]) == "captain"

    async def test_a_contact_with_no_rank_is_created_without_one(
        self, db_session: AsyncSession
    ):
        """Not every department ranks its IT people, and none has to here."""
        service, org = await _org(db_session)
        contact = _contact()

        await service.create_it_team_users(str(org.id), [contact])

        assert await _rank_of(db_session, contact["email"]) is None

    async def test_a_rank_the_department_removed_is_dropped_not_stored(
        self, db_session: AsyncSession
    ):
        """The ladder is edited after this step, so this ordering is reachable.

        Storing an unresolvable code would give the member no seats and no
        permissions with nothing saying why; refusing it would fail the whole
        of setup over an optional field.
        """
        service, org = await _org(db_session)
        contact = _contact("battalion_chief_we_deleted")

        created = await service.create_it_team_users(str(org.id), [contact])

        assert len(created) == 1
        assert await _rank_of(db_session, contact["email"]) is None

    async def test_a_rank_is_stored_in_its_canonical_spelling(
        self, db_session: AsyncSession
    ):
        """Every consumer of User.rank is an exact dictionary lookup.

        A value differing by case or surrounding whitespace resolves to no
        permissions and no seats, so what is stored has to be what
        resolve_rank_code returns rather than what the client sent.
        """
        service, org = await _org(db_session)
        await OperationalRankService(db_session).seed_defaults(str(org.id))
        contact = _contact("  Captain  ")

        await service.create_it_team_users(str(org.id), [contact])

        assert await _rank_of(db_session, contact["email"]) == "captain"
