"""Every fundraising edit returns the row it saved.

Workflow review W69, driven as the treasurer: marking a campaign restricted,
recording a payment against a pledge and editing a fundraising event all
showed "Internal server error", and the edit was rolled back. Each update
flushed, ``onupdate`` expired ``updated_at``, and the response model's lazy
read of it raised MissingGreenlet. Donor and donation edits failed the same
way through the API.

Also: a campaign created with a status was stored as Draft, because the
create schema had no status field.
"""

import uuid
from datetime import date, datetime, timezone
from decimal import Decimal

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import Organization, User
from app.schemas.grant import (
    CampaignCreate,
    CampaignResponse,
    DonationResponse,
    DonorResponse,
    FundraisingEventResponse,
    PledgeResponse,
)
from app.services.fundraising_service import FundraisingService

pytestmark = pytest.mark.integration


@pytest.fixture
async def setup(db_session: AsyncSession):
    org = Organization(
        id=str(uuid.uuid4()),
        name="Fundraising VFD",
        slug=f"fundraising-{uuid.uuid4().hex[:8]}",
        timezone="America/Chicago",
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
        "campaign": campaign,
        "donor": donor,
    }


class TestUpdatesReturnTheSavedRow:
    async def test_campaign(self, setup):
        updated = await setup["service"].update_campaign(
            setup["campaign"].id,
            setup["org_id"],
            {"is_restricted": True, "restriction_purpose": "Two cameras"},
        )
        response = CampaignResponse.model_validate(updated)
        assert response.is_restricted is True
        assert isinstance(response.updated_at, datetime)

    async def test_donor(self, setup):
        updated = await setup["service"].update_donor(
            setup["donor"].id, setup["org_id"], {"notes": "Prefers email"}
        )
        assert DonorResponse.model_validate(updated).notes == "Prefers email"

    async def test_donation(self, setup):
        donation = await setup["service"].create_donation(
            setup["org_id"],
            {
                "amount": Decimal("500"),
                "donation_date": datetime(2026, 10, 5, 5, tzinfo=timezone.utc),
                "payment_method": "check",
                "donor_id": setup["donor"].id,
                "campaign_id": setup["campaign"].id,
            },
            setup["user_id"],
        )
        updated = await setup["service"].update_donation(
            donation.id, setup["org_id"], {"notes": "Check #1042"}
        )
        assert DonationResponse.model_validate(updated).notes == "Check #1042"

    async def test_pledge_payment(self, setup):
        pledge = await setup["service"].create_pledge(
            setup["org_id"],
            {
                "donor_id": setup["donor"].id,
                "pledged_amount": Decimal("1000"),
                "pledge_date": date(2026, 10, 12),
            },
            setup["user_id"],
        )
        updated = await setup["service"].update_pledge(
            pledge.id,
            setup["org_id"],
            {"fulfilled_amount": Decimal("400"), "status": "partial"},
        )
        response = PledgeResponse.model_validate(updated)
        assert response.fulfilled_amount == Decimal("400")

    async def test_fundraising_event(self, setup):
        event = await setup["service"].create_fundraising_event(
            setup["org_id"],
            {
                "name": "Pancake Breakfast",
                "event_type": "dinner",
                "event_date": datetime(2026, 11, 8, 13, tzinfo=timezone.utc),
            },
            setup["user_id"],
        )
        updated = await setup["service"].update_fundraising_event(
            event.id, setup["org_id"], {"actual_revenue": Decimal("2850")}
        )
        response = FundraisingEventResponse.model_validate(updated)
        assert response.actual_revenue == Decimal("2850")


class TestCampaignCreateStatus:
    async def test_the_chosen_status_is_kept(self, setup):
        data = CampaignCreate.model_validate(
            {
                "name": "Pancake Breakfast 2026",
                "campaignType": "event",
                "goalAmount": 3000,
                "startDate": "2026-11-01",
                "status": "active",
            }
        )
        campaign = await setup["service"].create_campaign(
            setup["org_id"], data.model_dump(exclude_unset=True), setup["user_id"]
        )
        assert CampaignResponse.model_validate(campaign).status == "active"

    def test_draft_when_not_given(self):
        data = CampaignCreate.model_validate(
            {
                "name": "Drive",
                "campaignType": "general",
                "goalAmount": 1,
                "startDate": "2026-11-01",
            }
        )
        assert data.status == "draft"
