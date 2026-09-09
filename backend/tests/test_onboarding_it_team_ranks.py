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

from app.models.operational_rank import OperationalRank
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


class TestARankTheLadderNoLongerHas:
    """A *seeded* code the department deleted, which is the reachable case.

    ``resolve_rank_code`` answers from ``DEFAULT_RANK_CODES`` before it consults
    the organization's rows — deliberately, because a department onboarded
    before a code joined ``DEFAULT_RANKS`` has no row for it while the
    eligibility fallback still honours it, and rejecting those is the EMT bug in
    #1833. But the IT team is named at step 10 and its accounts are created at
    completion, with the ladder edited at step 11 in between, so that
    permissiveness let a code the administrator had just deleted be written
    anyway — and ``get_rank_default_permissions`` grants its static defaults, so
    the account held Captain-level access under a rank the ladder no longer
    lists.
    """

    async def test_a_seeded_code_with_no_rank_row_is_dropped(
        self, db_session: AsyncSession
    ):
        # No seed_defaults call: this organization has no rank rows at all,
        # which is what a department that deleted Captain looks like for that
        # one code.
        service, org = await _org(db_session)
        contact = _contact("captain")

        created = await service.create_it_team_users(str(org.id), [contact])

        assert len(created) == 1, "setup must not fail over an optional field"
        assert await _rank_of(db_session, contact["email"]) is None

    async def test_a_seeded_code_the_department_kept_is_still_stored(
        self, db_session: AsyncSession
    ):
        # The other half: requiring a row must not refuse a rank that exists.
        service, org = await _org(db_session)
        await OperationalRankService(db_session).seed_defaults(str(org.id))
        contact = _contact("captain")

        await service.create_it_team_users(str(org.id), [contact])

        assert await _rank_of(db_session, contact["email"]) == "captain"

    async def test_a_rank_the_department_added_itself_is_stored(
        self, db_session: AsyncSession
    ):
        # Requiring a row rather than a seed code is what makes a department's
        # own rank usable here at all.
        service, org = await _org(db_session)
        await OperationalRankService(db_session).seed_defaults(str(org.id))
        # Added as a row rather than through create_rank, which commits — this
        # fixture's transaction is rolled back per test.
        db_session.add(
            OperationalRank(
                organization_id=str(org.id),
                rank_code="squad_leader",
                display_name="Squad Leader",
                sort_order=99,
            )
        )
        await db_session.flush()
        contact = _contact("squad_leader")

        await service.create_it_team_users(str(org.id), [contact])

        assert await _rank_of(db_session, contact["email"]) == "squad_leader"


class TestThePrimaryContactIsTheSystemOwner:
    """The first IT row is auto-populated with the System Owner's email.

    So ``create_it_team_users`` finds that account, and used to ``continue``
    before reaching the rank block — silently discarding the rank chosen for the
    row the wizard fills in for you, which is the ordinary case rather than an
    edge one.
    """

    async def _owner(self, service: OnboardingService, org_id: str) -> str:
        unique = str(uuid.uuid4())[:8]
        email = f"owner-{unique}@example.com"
        await service.create_system_owner(
            organization_id=org_id,
            username=f"owner{unique}",
            email=email,
            password="Str0ng!Passw0rd#2026",
            first_name="Alex",
            last_name="Reyes",
        )
        return email

    async def test_the_rank_reaches_the_account_that_already_exists(
        self, db_session: AsyncSession
    ):
        service, org = await _org(db_session)
        await OperationalRankService(db_session).seed_defaults(str(org.id))
        email = await self._owner(service, str(org.id))

        created = await service.create_it_team_users(
            str(org.id),
            [{"name": "Alex Reyes", "email": email, "phone": "", "rank": "captain"}],
        )

        assert created == [], "the account exists; none is created"
        assert await _rank_of(db_session, email) == "captain"

    async def test_a_rank_already_set_is_not_overwritten(
        self, db_session: AsyncSession
    ):
        # The rank step runs after this one and gives the System Owner its own
        # picker, so a rank set there is the later and more deliberate choice.
        service, org = await _org(db_session)
        await OperationalRankService(db_session).seed_defaults(str(org.id))
        email = await self._owner(service, str(org.id))
        owner = (
            await db_session.execute(select(User).where(User.email == email))
        ).scalar_one()
        owner.rank = "fire_chief"
        await db_session.flush()

        await service.create_it_team_users(
            str(org.id),
            [{"name": "Alex Reyes", "email": email, "phone": "", "rank": "captain"}],
        )

        assert await _rank_of(db_session, email) == "fire_chief"

    async def test_a_deleted_rank_is_not_applied_to_the_existing_account_either(
        self, db_session: AsyncSession
    ):
        service, org = await _org(db_session)
        email = await self._owner(service, str(org.id))

        await service.create_it_team_users(
            str(org.id),
            [{"name": "Alex Reyes", "email": email, "phone": "", "rank": "captain"}],
        )

        assert await _rank_of(db_session, email) is None
