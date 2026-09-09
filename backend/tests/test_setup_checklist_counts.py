"""Each setup-checklist item counts the catalog its own page shows.

Medical stock and gear share one `inventory_categories` table, separated by
`item_type`, and the ordinary inventory API excludes `MEDICAL_ITEM_TYPES` from
every list it serves. So a count that does not make the same exclusion reports a
department "done" on the gear item on the strength of categories the gear page
never displays — which is the opposite of what a checklist is for, and worse
than having no item at all, because it says the work is finished.
"""

import uuid

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.endpoints.organizations import get_setup_checklist
from app.models.inventory import InventoryCategory, ItemType
from app.models.user import Organization, User

pytestmark = [pytest.mark.integration]


async def _org(db_session: AsyncSession) -> Organization:
    unique = str(uuid.uuid4())[:8]
    org = Organization(
        name=f"Checklist Test VFD {unique}",
        slug=f"checklist-test-{unique}",
        settings={"modules": {"inventory": True, "medical_supplies": True}},
    )
    db_session.add(org)
    await db_session.flush()
    return org


async def _category(
    db_session: AsyncSession, org: Organization, name: str, item_type: ItemType
) -> InventoryCategory:
    category = InventoryCategory(
        organization_id=org.id,
        name=f"{name}-{str(uuid.uuid4())[:8]}",
        item_type=item_type,
        active=True,
    )
    db_session.add(category)
    await db_session.flush()
    return category


def _caller(org: Organization) -> User:
    return User(organization_id=org.id, username="officer", email="o@example.com")


async def _item(db_session: AsyncSession, org: Organization, key: str):
    response = await get_setup_checklist(db_session, _caller(org))
    for item in response.items:
        if item.key == key:
            return item
    return None


class TestTheInventoryAndMedicalItemsCountSeparately:
    async def test_a_medical_category_alone_does_not_complete_the_gear_item(
        self, db_session: AsyncSession
    ):
        org = await _org(db_session)
        await _category(db_session, org, "Airway", ItemType.MEDICAL)

        gear = await _item(db_session, org, "inventory")

        assert gear is not None
        assert gear.count == 0
        assert gear.is_complete is False

    async def test_a_medical_category_does_complete_the_medical_item(
        self, db_session: AsyncSession
    ):
        org = await _org(db_session)
        await _category(db_session, org, "Airway", ItemType.MEDICAL)

        medical = await _item(db_session, org, "medical_supplies")

        assert medical is not None
        assert medical.count == 1
        assert medical.is_complete is True

    async def test_a_gear_category_alone_does_not_complete_the_medical_item(
        self, db_session: AsyncSession
    ):
        org = await _org(db_session)
        await _category(db_session, org, "Turnout Gear", ItemType.PPE)

        medical = await _item(db_session, org, "medical_supplies")

        assert medical is not None
        assert medical.count == 0
        assert medical.is_complete is False

    async def test_a_gear_category_completes_the_gear_item(
        self, db_session: AsyncSession
    ):
        org = await _org(db_session)
        await _category(db_session, org, "Turnout Gear", ItemType.PPE)

        gear = await _item(db_session, org, "inventory")

        assert gear is not None
        assert gear.count == 1
        assert gear.is_complete is True

    async def test_the_two_counts_do_not_overlap(self, db_session: AsyncSession):
        org = await _org(db_session)
        await _category(db_session, org, "Turnout Gear", ItemType.PPE)
        await _category(db_session, org, "Airway", ItemType.MEDICAL)
        await _category(db_session, org, "Nitrile Gloves", ItemType.MEDICAL)

        gear = await _item(db_session, org, "inventory")
        medical = await _item(db_session, org, "medical_supplies")

        assert gear is not None
        assert medical is not None
        assert (gear.count, medical.count) == (1, 2)
