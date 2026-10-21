"""A deleted campaign is gone, not merely hidden from the list.

Deleting a campaign clears ``active``. ``list_campaigns`` honoured that, but
``get_campaign`` did not, so the deleted campaign could still be read, edited
and "deleted" again by id, and new donations, pledges and events could still
be filed under it. A record already filed under it before the delete keeps
it through later edits.
"""

import uuid
from datetime import date
from decimal import Decimal

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import Organization, User
from app.services.fundraising_service import FundraisingService

pytestmark = pytest.mark.integration


@pytest.fixture
async def dept(db_session: AsyncSession):
    org = Organization(
        id=str(uuid.uuid4()),
        name="Fundraising VFD",
        slug=f"fr-deleted-{uuid.uuid4().hex[:8]}",
        timezone="UTC",
    )
    db_session.add(org)
    await db_session.flush()
    name = f"treasurer-{uuid.uuid4().hex[:8]}"
    user = User(
        organization_id=org.id,
        username=name,
        first_name="Tess",
        last_name="Park",
        email=f"{name}@example.com",
    )
    db_session.add(user)
    await db_session.flush()
    service = FundraisingService(db_session)
    campaign = await service.create_campaign(
        org.id,
        {
            "name": "Thermal Camera Drive",
            "campaign_type": "equipment",
            "goal_amount": Decimal("25000"),
            "start_date": date(2026, 10, 1),
        },
        user.id,
    )
    donor = await service.create_donor(
        org.id, {"first_name": "Maria", "last_name": "Lopez"}
    )
    return {
        "service": service,
        "org_id": org.id,
        "user_id": user.id,
        "campaign_id": campaign.id,
        "donor_id": donor.id,
    }


class TestADeletedCampaign:
    async def test_cannot_be_read_edited_or_deleted_again(self, dept):
        service, org_id, campaign_id = (
            dept["service"],
            dept["org_id"],
            dept["campaign_id"],
        )
        assert await service.delete_campaign(campaign_id, org_id) is True

        assert await service.get_campaign(campaign_id, org_id) is None
        assert (
            await service.update_campaign(campaign_id, org_id, {"name": "Revived"})
            is None
        )
        assert await service.delete_campaign(campaign_id, org_id) is False

    async def test_takes_no_new_donations_pledges_or_events(self, dept):
        service, org_id, campaign_id = (
            dept["service"],
            dept["org_id"],
            dept["campaign_id"],
        )
        await service.delete_campaign(campaign_id, org_id)

        with pytest.raises(ValueError, match="Campaign not found"):
            await service.create_donation(
                org_id,
                {
                    "campaign_id": campaign_id,
                    "donor_id": dept["donor_id"],
                    "amount": Decimal("50"),
                    "donation_date": date(2026, 10, 5),
                },
                dept["user_id"],
            )
        with pytest.raises(ValueError, match="Campaign not found"):
            await service.create_pledge(
                org_id,
                {
                    "campaign_id": campaign_id,
                    "donor_id": dept["donor_id"],
                    "pledged_amount": Decimal("100"),
                    "pledge_date": date(2026, 10, 5),
                },
                dept["user_id"],
            )
        with pytest.raises(ValueError, match="Campaign not found"):
            await service.create_fundraising_event(
                org_id,
                {
                    "campaign_id": campaign_id,
                    "name": "Pancake breakfast",
                    "event_type": "dinner",
                    "event_date": date(2026, 11, 1),
                },
                dept["user_id"],
            )

    async def test_a_pledge_filed_before_the_delete_can_still_be_edited(self, dept):
        service, org_id, campaign_id = (
            dept["service"],
            dept["org_id"],
            dept["campaign_id"],
        )
        pledge = await service.create_pledge(
            org_id,
            {
                "campaign_id": campaign_id,
                "donor_id": dept["donor_id"],
                "pledged_amount": Decimal("100"),
                "pledge_date": date(2026, 10, 5),
            },
            dept["user_id"],
        )
        pledge_id = pledge.id
        await service.delete_campaign(campaign_id, org_id)

        updated = await service.update_pledge(
            pledge_id,
            org_id,
            {"campaign_id": campaign_id, "notes": "Called to confirm"},
        )
        assert updated is not None
        assert updated.notes == "Called to confirm"
