"""Zeffy linking endpoints: tenancy, the dues permission, and what a link does.

Integration: the handlers are called directly against MySQL with a stand-in
user, so permission dependencies are not exercised here — the route table's
``require_permission`` coverage is policed by test_endpoint_auth_coverage.
"""

from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import patch

import pytest
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.endpoints import zeffy as endpoints
from app.models.finance import DuesFrequency, DuesSchedule
from app.models.grant import CampaignType, Donation, FundraisingCampaign
from app.models.integration import Integration
from app.models.zeffy import ZeffyLinkTarget, ZeffyPaymentState
from app.schemas.zeffy import ZeffyLinkUpsert, ZeffyPaymentResponse
from app.services.zeffy_sync_service import ZeffySyncService
from tests.test_zeffy_sync_service import PAID, _org, zeffy_payment

pytestmark = [pytest.mark.integration]


def _user(org_id: str, user_id: str) -> SimpleNamespace:
    return SimpleNamespace(id=user_id, organization_id=org_id)


async def _connect(db: AsyncSession, org_id: str) -> Integration:
    integration = Integration(
        organization_id=org_id,
        integration_type="zeffy",
        name="Zeffy",
        category="Payments",
        status="connected",
        enabled=True,
        config={},
    )
    integration.set_secret("api_key", "key")
    db.add(integration)
    await db.flush()
    return integration


async def _campaign(db: AsyncSession, org_id: str) -> FundraisingCampaign:
    campaign = FundraisingCampaign(
        organization_id=org_id,
        name="Engine fund",
        campaign_type=CampaignType.EQUIPMENT,
        goal_amount=Decimal("10000"),
        start_date=date(2026, 1, 1),
    )
    db.add(campaign)
    await db.flush()
    return campaign


@pytest.fixture
async def scene(db_session: AsyncSession, setup_org_and_admin):
    org_id, user_id = setup_org_and_admin
    await _connect(db_session, org_id)
    return org_id, user_id, _user(org_id, user_id)


class TestUpsertLink:
    async def test_linking_applies_the_payments_already_waiting(
        self, db_session, scene
    ):
        org_id, _, user = scene
        await ZeffySyncService(db_session).record_payment(
            org_id, "pay_1", zeffy_payment()
        )
        campaign = await _campaign(db_session, org_id)

        response = await endpoints.upsert_zeffy_link(
            "camp_1",
            ZeffyLinkUpsert(
                target_type=ZeffyLinkTarget.FUNDRAISING_CAMPAIGN,
                target_id=campaign.id,
                apply_from=PAID - timedelta(days=1),
            ),
            db=db_session,
            current_user=user,
        )

        assert response.target_name == "Engine fund"
        donations = (
            await db_session.scalars(
                select(Donation).where(Donation.organization_id == org_id)
            )
        ).all()
        assert len(donations) == 1

    async def test_with_no_start_date_only_new_payments_apply(self, db_session, scene):
        org_id, _, user = scene
        await ZeffySyncService(db_session).record_payment(
            org_id, "pay_1", zeffy_payment()
        )
        campaign = await _campaign(db_session, org_id)

        response = await endpoints.upsert_zeffy_link(
            "camp_1",
            ZeffyLinkUpsert(
                target_type=ZeffyLinkTarget.FUNDRAISING_CAMPAIGN,
                target_id=campaign.id,
            ),
            db=db_session,
            current_user=user,
        )

        assert response.apply_from > PAID
        listing = await endpoints.list_zeffy_payments(
            state=None, limit=50, offset=0, db=db_session, current_user=user
        )
        assert [p.state for p in listing.items] == [ZeffyPaymentState.BEFORE_START]

    async def test_another_departments_record_is_refused(self, db_session, scene):
        _, _, user = scene
        other_org = await _org(db_session)
        foreign = await _campaign(db_session, other_org)

        with pytest.raises(HTTPException) as caught:
            await endpoints.upsert_zeffy_link(
                "camp_1",
                ZeffyLinkUpsert(
                    target_type=ZeffyLinkTarget.FUNDRAISING_CAMPAIGN,
                    target_id=foreign.id,
                ),
                db=db_session,
                current_user=user,
            )
        assert caught.value.status_code == 400

    async def test_a_dues_link_needs_finance_manage(self, db_session, scene):
        org_id, user_id, user = scene
        schedule = DuesSchedule(
            organization_id=org_id,
            name="Annual dues",
            amount=Decimal("120"),
            frequency=DuesFrequency.ANNUAL,
            due_date=datetime.now(timezone.utc),
            created_by=user_id,
        )
        db_session.add(schedule)
        await db_session.flush()
        body = ZeffyLinkUpsert(
            target_type=ZeffyLinkTarget.DUES_SCHEDULE, target_id=schedule.id
        )

        with patch.object(endpoints, "user_has_permission", return_value=False):
            with pytest.raises(HTTPException) as caught:
                await endpoints.upsert_zeffy_link(
                    "camp_m", body, db=db_session, current_user=user
                )
        assert caught.value.status_code == 403

        with patch.object(endpoints, "user_has_permission", return_value=True):
            response = await endpoints.upsert_zeffy_link(
                "camp_m", body, db=db_session, current_user=user
            )
        assert response.target_id == schedule.id

    async def test_without_a_connection_nothing_is_linked(
        self, db_session, setup_org_and_admin
    ):
        org_id, user_id = setup_org_and_admin
        campaign = await _campaign(db_session, org_id)

        with pytest.raises(HTTPException) as caught:
            await endpoints.upsert_zeffy_link(
                "camp_1",
                ZeffyLinkUpsert(
                    target_type=ZeffyLinkTarget.FUNDRAISING_CAMPAIGN,
                    target_id=campaign.id,
                ),
                db=db_session,
                current_user=_user(org_id, user_id),
            )
        assert caught.value.status_code == 409

    async def test_an_earlier_start_rereads_the_campaign(self, db_session, scene):
        org_id, _, user = scene
        campaign = await _campaign(db_session, org_id)
        body = ZeffyLinkUpsert(
            target_type=ZeffyLinkTarget.FUNDRAISING_CAMPAIGN,
            target_id=campaign.id,
            apply_from=PAID,
        )
        await endpoints.upsert_zeffy_link(
            "camp_1", body, db=db_session, current_user=user
        )
        link = (await endpoints._links_by_campaign(db_session, org_id))["camp_1"]
        link.synced_through = PAID + timedelta(days=30)
        await db_session.flush()

        response = await endpoints.upsert_zeffy_link(
            "camp_1",
            body.model_copy(update={"apply_from": PAID - timedelta(days=365)}),
            db=db_session,
            current_user=user,
        )
        assert response.synced_through is None


class TestStatusAndPayments:
    async def test_status_counts_payments_by_state(self, db_session, scene):
        org_id, _, user = scene
        service = ZeffySyncService(db_session)
        await service.record_payment(org_id, "pay_1", zeffy_payment("pay_1"))
        await service.record_payment(
            org_id, "pay_2", zeffy_payment("pay_2", status="pending")
        )

        status = await endpoints.get_zeffy_status(db=db_session, current_user=user)

        assert status.connected is True
        assert status.webhook_configured is False
        assert status.state_counts == {"unlinked": 1, "pending": 1}

    async def test_the_payer_email_is_never_returned(self, db_session, scene):
        org_id, _, user = scene
        await ZeffySyncService(db_session).record_payment(
            org_id, "pay_1", zeffy_payment()
        )
        listing = await endpoints.list_zeffy_payments(
            state=None, limit=50, offset=0, db=db_session, current_user=user
        )
        assert listing.total == 1
        assert "payer_email" not in ZeffyPaymentResponse.model_fields
        dumped = listing.model_dump(by_alias=True)
        assert "pat@example.org" not in str(dumped)
        assert dumped["items"][0]["payerName"] == "Pat Donor"

    async def test_another_departments_payments_are_not_listed(self, db_session, scene):
        _, _, user = scene
        other_org = await _org(db_session)
        await ZeffySyncService(db_session).record_payment(
            other_org, "pay_1", zeffy_payment()
        )
        listing = await endpoints.list_zeffy_payments(
            state=None, limit=50, offset=0, db=db_session, current_user=user
        )
        assert listing.total == 0
