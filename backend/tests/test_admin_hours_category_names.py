"""An organization cannot hold two active admin-hours categories of one name.

Workflow review W70: the seeded "Station Maintenance" already existed, and
"Add Category" created a second one, then a third as "station maintenance".
A member then chooses between identical names at clock-in, and the summary
splits their hours across rows nobody can tell apart.
"""

import uuid

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import Organization, User
from app.services.admin_hours_service import AdminHoursService

pytestmark = pytest.mark.integration


@pytest.fixture
async def setup(db_session: AsyncSession):
    org = Organization(
        id=str(uuid.uuid4()),
        name="Hours VFD",
        slug=f"hours-{uuid.uuid4().hex[:8]}",
        timezone="America/Chicago",
    )
    db_session.add(org)
    await db_session.flush()
    name = f"admin-{uuid.uuid4().hex[:8]}"
    user = User(
        organization_id=org.id,
        username=name,
        first_name="Riley",
        last_name="Owner",
        email=f"{name}@example.com",
    )
    db_session.add(user)
    await db_session.flush()
    service = AdminHoursService(db_session)
    existing = await service.create_category(
        organization_id=org.id, created_by=user.id, name="Station Maintenance"
    )
    return {
        "service": service,
        "org_id": org.id,
        "user_id": user.id,
        "existing": existing,
    }


class TestCategoryNames:
    @pytest.mark.parametrize(
        "name", ["Station Maintenance", "station maintenance", "  Station Maintenance "]
    )
    async def test_a_second_active_category_of_the_same_name_is_refused(
        self, setup, name
    ):
        with pytest.raises(ValueError, match="already an active category"):
            await setup["service"].create_category(
                organization_id=setup["org_id"], created_by=setup["user_id"], name=name
            )

    async def test_another_organization_may_use_the_name(self, setup, db_session):
        other = Organization(
            id=str(uuid.uuid4()),
            name="Other VFD",
            slug=f"other-{uuid.uuid4().hex[:8]}",
            timezone="UTC",
        )
        db_session.add(other)
        await db_session.flush()
        created = await setup["service"].create_category(
            organization_id=other.id,
            created_by=setup["user_id"],
            name="Station Maintenance",
        )
        assert created.name == "Station Maintenance"

    async def test_a_retired_name_can_be_reused(self, setup):
        await setup["service"].delete_category(setup["existing"].id, setup["org_id"])
        created = await setup["service"].create_category(
            organization_id=setup["org_id"],
            created_by=setup["user_id"],
            name="Station Maintenance",
        )
        assert created.is_active is True

    async def test_renaming_onto_a_taken_name_is_refused(self, setup):
        other = await setup["service"].create_category(
            organization_id=setup["org_id"],
            created_by=setup["user_id"],
            name="Grounds",
        )
        with pytest.raises(ValueError, match="already an active category"):
            await setup["service"].update_category(
                other.id, setup["org_id"], setup["user_id"], name="station maintenance"
            )

    async def test_saving_a_category_under_its_own_name_is_allowed(self, setup):
        updated = await setup["service"].update_category(
            setup["existing"].id,
            setup["org_id"],
            setup["user_id"],
            name="Station Maintenance",
            description="Bays and grounds",
        )
        assert updated.description == "Bays and grounds"

    async def test_reactivating_onto_a_taken_name_is_refused(self, setup):
        await setup["service"].delete_category(setup["existing"].id, setup["org_id"])
        await setup["service"].create_category(
            organization_id=setup["org_id"],
            created_by=setup["user_id"],
            name="Station Maintenance",
        )
        with pytest.raises(ValueError, match="already an active category"):
            await setup["service"].update_category(
                setup["existing"].id, setup["org_id"], setup["user_id"], is_active=True
            )
