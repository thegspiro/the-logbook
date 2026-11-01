"""Zeffy payments reach donations, event revenue and member dues — once.

Integration: the ledger's unique key, the row locks and every target are SQL.
Zeffy itself is replaced by payment dicts shaped like its published schema
(amounts in cents) and, for the sync and the webhook, by a fake client.
"""

import hashlib
import hmac
import json
import time
import uuid
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.public import zeffy_webhook
from app.core.security import email_fingerprint
from app.models.finance import (
    DuesFrequency,
    DuesPayment,
    DuesSchedule,
    DuesStatus,
    MemberDues,
)
from app.models.grant import (
    CampaignType,
    Donation,
    Donor,
    FundraisingCampaign,
    FundraisingEvent,
    FundraisingEventType,
    PaymentStatus,
)
from app.models.integration import Integration
from app.models.zeffy import (
    ZeffyCampaignLink,
    ZeffyLinkTarget,
    ZeffyPayment,
    ZeffyPaymentState,
)
from app.services.integration_services.zeffy_service import ZeffyRateLimited
from app.services.zeffy_sync_service import SYNC_WINDOW, ZeffySyncService

pytestmark = [pytest.mark.integration]

LONG_AGO = datetime(2020, 1, 1, tzinfo=timezone.utc)
PAID = datetime(2026, 10, 1, 12, tzinfo=timezone.utc)


def zeffy_payment(
    payment_id: str = "pay_1",
    *,
    campaign_id: str = "camp_1",
    amount: int = 5000,
    status: str = "succeeded",
    refunds: list | None = None,
    refund_status: str = "none",
    email: str = "pat@example.org",
    first_name: str = "Pat",
    last_name: str = "Donor",
    tickets: int = 0,
    paid_at: datetime = PAID,
) -> dict:
    items = [{"type": "ticket", "amount": amount // max(tickets, 1)}] * tickets or [
        {"type": "donation", "amount": amount, "tribute": None}
    ]
    return {
        "id": payment_id,
        "object": "payment",
        "created": int(paid_at.timestamp()),
        "amount": amount,
        "currency": "usd",
        "status": status,
        "type": "online",
        "refund_status": refund_status,
        "refunds": refunds or [],
        "dispute": None,
        "description": "Zeffy campaign",
        "payment_method": {"type": "card", "brand": "visa", "last4": "4242"},
        "buyer": {
            "email": email,
            "first_name": first_name,
            "last_name": last_name,
            "is_corporate": False,
            "company_name": None,
            "address": {"line1": "1 Main St"},
        },
        "campaign_id": campaign_id,
        "campaign_category": "donation",
        "parent_campaign_id": None,
        "items": items,
        "receipt_url": "https://zeffy.example/r/1",
        "recurring": None,
    }


def refunded(amount: int) -> list:
    return [{"amount": amount, "status": "succeeded", "created": 1}]


# ---------------------------------------------------------------------------
# Scene
# ---------------------------------------------------------------------------


async def _org(db: AsyncSession) -> str:
    org_id = str(uuid.uuid4())
    await db.execute(
        text(
            "INSERT INTO organizations (id, name, organization_type, slug, "
            "timezone, active) VALUES (:i, 'Zeffy FD', 'fire_department', "
            ":s, 'UTC', 1)"
        ),
        {"i": org_id, "s": f"zeffy-{org_id[:8]}"},
    )
    return org_id


async def _member(db: AsyncSession, org_id: str, email: str) -> str:
    member_id = str(uuid.uuid4())
    await db.execute(
        text(
            "INSERT INTO users (id, organization_id, username, first_name, "
            "last_name, email, email_hash, password_hash, status) VALUES "
            "(:id, :org, :un, 'Dana', 'Member', :em, :eh, 'x', 'active')"
        ),
        {
            "id": member_id,
            "org": org_id,
            "un": f"dana-{member_id[:8]}",
            "em": email,
            "eh": email_fingerprint(email),
        },
    )
    return member_id


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
    await db.refresh(campaign)
    return campaign


async def _event(db: AsyncSession, org_id: str) -> FundraisingEvent:
    event = FundraisingEvent(
        organization_id=org_id,
        name="Pancake breakfast",
        event_type=FundraisingEventType.DINNER,
        event_date=datetime(2026, 11, 1, tzinfo=timezone.utc),
        actual_revenue=Decimal("100.00"),
        current_attendees=5,
    )
    db.add(event)
    await db.flush()
    await db.refresh(event)
    return event


async def _dues(
    db: AsyncSession, org_id: str, officer_id: str, member_id: str
) -> tuple[DuesSchedule, MemberDues]:
    schedule = DuesSchedule(
        organization_id=org_id,
        name="Annual dues",
        amount=Decimal("120.00"),
        frequency=DuesFrequency.ANNUAL,
        due_date=datetime.now(timezone.utc) + timedelta(days=30),
        created_by=officer_id,
    )
    db.add(schedule)
    await db.flush()
    dues = MemberDues(
        organization_id=org_id,
        dues_schedule_id=schedule.id,
        user_id=member_id,
        amount_due=Decimal("120.00"),
        amount_paid=Decimal("0.00"),
        status=DuesStatus.PENDING,
        due_date=schedule.due_date,
    )
    db.add(dues)
    await db.flush()
    return schedule, dues


async def _link(
    db: AsyncSession,
    org_id: str,
    target_type: ZeffyLinkTarget,
    target_id: str,
    campaign_id: str = "camp_1",
    apply_from: datetime = LONG_AGO,
) -> ZeffyCampaignLink:
    column = {
        ZeffyLinkTarget.FUNDRAISING_CAMPAIGN: "fundraising_campaign_id",
        ZeffyLinkTarget.FUNDRAISING_EVENT: "fundraising_event_id",
        ZeffyLinkTarget.DUES_SCHEDULE: "dues_schedule_id",
    }[target_type]
    link = ZeffyCampaignLink(
        organization_id=org_id,
        zeffy_campaign_id=campaign_id,
        target_type=target_type,
        apply_from=apply_from,
        **{column: target_id},
    )
    db.add(link)
    await db.flush()
    await db.refresh(link)
    return link


async def _donations(db: AsyncSession, org_id: str) -> list[Donation]:
    return list(
        (
            await db.scalars(select(Donation).where(Donation.organization_id == org_id))
        ).all()
    )


@pytest.fixture
async def org(db_session: AsyncSession, setup_org_and_admin):
    return setup_org_and_admin


# ---------------------------------------------------------------------------
# Fundraising campaign
# ---------------------------------------------------------------------------


class TestCampaignDonations:
    async def test_a_payment_becomes_one_donation_however_often_it_arrives(
        self, db_session, org
    ):
        org_id, _ = org
        campaign = await _campaign(db_session, org_id)
        await _link(
            db_session, org_id, ZeffyLinkTarget.FUNDRAISING_CAMPAIGN, campaign.id
        )
        service = ZeffySyncService(db_session)

        for _ in range(3):
            row = await service.record_payment(org_id, "pay_1", zeffy_payment())

        donations = await _donations(db_session, org_id)
        assert len(donations) == 1
        donation = donations[0]
        assert donation.amount == Decimal("50.00")
        assert donation.campaign_id == campaign.id
        assert donation.transaction_id == "zeffy:pay_1"
        assert donation.payment_status == PaymentStatus.COMPLETED
        assert row is not None
        assert row.state == ZeffyPaymentState.APPLIED
        assert row.donation_id == donation.id
        await db_session.refresh(campaign)
        assert campaign.current_amount == Decimal("50.00")

    async def test_the_payer_becomes_a_donor_once_and_is_reused(self, db_session, org):
        org_id, _ = org
        campaign = await _campaign(db_session, org_id)
        await _link(
            db_session, org_id, ZeffyLinkTarget.FUNDRAISING_CAMPAIGN, campaign.id
        )
        service = ZeffySyncService(db_session)
        await service.record_payment(org_id, "pay_1", zeffy_payment("pay_1"))
        await service.record_payment(org_id, "pay_2", zeffy_payment("pay_2"))

        donors = list(
            (
                await db_session.scalars(
                    select(Donor).where(Donor.organization_id == org_id)
                )
            ).all()
        )
        assert len(donors) == 1
        assert (donors[0].first_name, donors[0].last_name) == ("Pat", "Donor")
        await db_session.refresh(donors[0])
        assert donors[0].total_donated == Decimal("100.00")

    async def test_a_partial_refund_lowers_the_donation(self, db_session, org):
        org_id, _ = org
        campaign = await _campaign(db_session, org_id)
        await _link(
            db_session, org_id, ZeffyLinkTarget.FUNDRAISING_CAMPAIGN, campaign.id
        )
        service = ZeffySyncService(db_session)
        await service.record_payment(org_id, "pay_1", zeffy_payment())

        row = await service.record_payment(
            org_id,
            "pay_1",
            zeffy_payment(refunds=refunded(2000), refund_status="partial"),
        )

        (donation,) = await _donations(db_session, org_id)
        assert donation.amount == Decimal("30.00")
        assert row is not None
        assert row.applied_amount == Decimal("30.00")
        await db_session.refresh(campaign)
        assert campaign.current_amount == Decimal("30.00")

    async def test_a_full_refund_marks_the_donation_refunded(self, db_session, org):
        org_id, _ = org
        campaign = await _campaign(db_session, org_id)
        await _link(
            db_session, org_id, ZeffyLinkTarget.FUNDRAISING_CAMPAIGN, campaign.id
        )
        service = ZeffySyncService(db_session)
        await service.record_payment(org_id, "pay_1", zeffy_payment())

        row = await service.record_payment(
            org_id,
            "pay_1",
            zeffy_payment(refunds=refunded(5000), refund_status="full"),
        )

        (donation,) = await _donations(db_session, org_id)
        assert donation.payment_status == PaymentStatus.REFUNDED
        assert row is not None
        assert row.state == ZeffyPaymentState.REVERSED
        await db_session.refresh(campaign)
        assert campaign.current_amount == Decimal("0.00")

    async def test_a_payment_deleted_in_zeffy_is_taken_back(self, db_session, org):
        org_id, _ = org
        campaign = await _campaign(db_session, org_id)
        await _link(
            db_session, org_id, ZeffyLinkTarget.FUNDRAISING_CAMPAIGN, campaign.id
        )
        service = ZeffySyncService(db_session)
        await service.record_payment(org_id, "pay_1", zeffy_payment())

        row = await service.record_payment(org_id, "pay_1", None)

        assert row is not None
        assert row.deleted_in_zeffy
        assert row.state == ZeffyPaymentState.REVERSED
        (donation,) = await _donations(db_session, org_id)
        assert donation.payment_status == PaymentStatus.REFUNDED

    async def test_a_pending_payment_waits_then_applies(self, db_session, org):
        org_id, _ = org
        campaign = await _campaign(db_session, org_id)
        await _link(
            db_session, org_id, ZeffyLinkTarget.FUNDRAISING_CAMPAIGN, campaign.id
        )
        service = ZeffySyncService(db_session)

        row = await service.record_payment(
            org_id, "pay_1", zeffy_payment(status="pending")
        )
        assert row is not None
        assert row.state == ZeffyPaymentState.PENDING
        assert await _donations(db_session, org_id) == []

        row = await service.record_payment(org_id, "pay_1", zeffy_payment())
        assert row is not None
        assert row.state == ZeffyPaymentState.APPLIED
        assert len(await _donations(db_session, org_id)) == 1

    async def test_the_buyer_email_is_encrypted_not_kept_in_the_payload(
        self, db_session, org
    ):
        org_id, _ = org
        row = await ZeffySyncService(db_session).record_payment(
            org_id, "pay_1", zeffy_payment()
        )
        assert row is not None
        assert row.payer_email == "pat@example.org"
        assert "email" not in row.raw_payload["buyer"]
        stored = await db_session.scalar(
            text("SELECT payer_email FROM zeffy_payments WHERE id = :i"),
            {"i": row.id},
        )
        assert stored
        assert "pat@example.org" not in stored


# ---------------------------------------------------------------------------
# Links, start dates, tenancy
# ---------------------------------------------------------------------------


class TestLinking:
    async def test_an_unlinked_payment_waits_and_applies_once_linked(
        self, db_session, org
    ):
        org_id, _ = org
        service = ZeffySyncService(db_session)
        row = await service.record_payment(org_id, "pay_1", zeffy_payment())
        assert row is not None
        assert row.state == ZeffyPaymentState.UNLINKED

        campaign = await _campaign(db_session, org_id)
        await _link(
            db_session, org_id, ZeffyLinkTarget.FUNDRAISING_CAMPAIGN, campaign.id
        )
        applied = await service.retry_unapplied(org_id, zeffy_campaign_id="camp_1")

        assert applied == 1
        await db_session.refresh(row)
        assert row.state == ZeffyPaymentState.APPLIED
        assert len(await _donations(db_session, org_id)) == 1

    async def test_a_payment_before_the_start_date_is_not_applied(
        self, db_session, org
    ):
        org_id, _ = org
        campaign = await _campaign(db_session, org_id)
        await _link(
            db_session,
            org_id,
            ZeffyLinkTarget.FUNDRAISING_CAMPAIGN,
            campaign.id,
            apply_from=PAID + timedelta(days=1),
        )

        row = await ZeffySyncService(db_session).record_payment(
            org_id, "pay_1", zeffy_payment()
        )

        assert row is not None
        assert row.state == ZeffyPaymentState.BEFORE_START
        assert await _donations(db_session, org_id) == []

    async def test_another_departments_link_is_never_used(self, db_session, org):
        org_id, _ = org
        other_org = await _org(db_session)
        other_campaign = await _campaign(db_session, other_org)
        await _link(
            db_session,
            other_org,
            ZeffyLinkTarget.FUNDRAISING_CAMPAIGN,
            other_campaign.id,
        )

        row = await ZeffySyncService(db_session).record_payment(
            org_id, "pay_1", zeffy_payment()
        )

        assert row is not None
        assert row.state == ZeffyPaymentState.UNLINKED
        assert await _donations(db_session, other_org) == []

    async def test_the_same_payment_id_in_two_departments_is_two_rows(
        self, db_session, org
    ):
        org_id, _ = org
        other_org = await _org(db_session)
        service = ZeffySyncService(db_session)
        first = await service.record_payment(org_id, "pay_1", zeffy_payment())
        second = await service.record_payment(other_org, "pay_1", zeffy_payment())
        assert first is not None
        assert second is not None
        assert first.id != second.id

    async def test_a_racing_insert_returns_the_existing_row(self, db_session, org):
        org_id, _ = org
        service = ZeffySyncService(db_session)
        first = await service._insert_row(org_id, "pay_1")
        second = await service._insert_row(org_id, "pay_1")
        assert first.id == second.id

    async def test_an_unknown_payment_already_deleted_records_nothing(
        self, db_session, org
    ):
        org_id, _ = org
        assert (
            await ZeffySyncService(db_session).record_payment(org_id, "gone", None)
            is None
        )


# ---------------------------------------------------------------------------
# Fundraising event
# ---------------------------------------------------------------------------


class TestEventTickets:
    async def test_tickets_add_to_hand_kept_totals_once(self, db_session, org):
        org_id, _ = org
        event = await _event(db_session, org_id)
        await _link(db_session, org_id, ZeffyLinkTarget.FUNDRAISING_EVENT, event.id)
        service = ZeffySyncService(db_session)

        for _ in range(2):
            row = await service.record_payment(
                org_id, "pay_1", zeffy_payment(amount=4000, tickets=2)
            )

        await db_session.refresh(event)
        assert event.actual_revenue == Decimal("140.00")
        assert event.current_attendees == 7
        assert row is not None
        assert row.state == ZeffyPaymentState.APPLIED
        assert await _donations(db_session, org_id) == []

    async def test_a_refund_takes_back_exactly_what_was_added(self, db_session, org):
        org_id, _ = org
        event = await _event(db_session, org_id)
        await _link(db_session, org_id, ZeffyLinkTarget.FUNDRAISING_EVENT, event.id)
        service = ZeffySyncService(db_session)
        await service.record_payment(
            org_id, "pay_1", zeffy_payment(amount=4000, tickets=2)
        )

        await service.record_payment(
            org_id,
            "pay_1",
            zeffy_payment(
                amount=4000, tickets=2, refunds=refunded(1000), refund_status="partial"
            ),
        )
        await db_session.refresh(event)
        assert event.actual_revenue == Decimal("130.00")
        assert event.current_attendees == 7

        row = await service.record_payment(
            org_id,
            "pay_1",
            zeffy_payment(
                amount=4000, tickets=2, refunds=refunded(4000), refund_status="full"
            ),
        )
        await db_session.refresh(event)
        assert (event.actual_revenue, event.current_attendees) == (Decimal("100.00"), 5)
        assert row is not None
        assert row.state == ZeffyPaymentState.REVERSED


# ---------------------------------------------------------------------------
# Dues
# ---------------------------------------------------------------------------


class TestMembershipDues:
    async def test_a_members_payment_is_credited_to_their_open_dues(
        self, db_session, org
    ):
        org_id, officer_id = org
        member_id = await _member(db_session, org_id, "dana@fd.test")
        schedule, dues = await _dues(db_session, org_id, officer_id, member_id)
        await _link(db_session, org_id, ZeffyLinkTarget.DUES_SCHEDULE, schedule.id)
        service = ZeffySyncService(db_session)

        for _ in range(2):
            row = await service.record_payment(
                org_id, "pay_1", zeffy_payment(amount=12000, email="dana@fd.test")
            )

        await db_session.refresh(dues)
        assert (dues.amount_paid, dues.status) == (Decimal("120.00"), DuesStatus.PAID)
        payments = list(
            (
                await db_session.scalars(
                    select(DuesPayment).where(DuesPayment.member_dues_id == dues.id)
                )
            ).all()
        )
        assert [p.transaction_reference for p in payments] == ["zeffy:pay_1"]
        assert payments[0].recorded_by is None
        assert row is not None
        assert row.state == ZeffyPaymentState.APPLIED
        assert row.member_dues_id == dues.id

    async def test_a_refund_after_crediting_is_flagged_not_reversed(
        self, db_session, org
    ):
        org_id, officer_id = org
        member_id = await _member(db_session, org_id, "dana@fd.test")
        schedule, dues = await _dues(db_session, org_id, officer_id, member_id)
        await _link(db_session, org_id, ZeffyLinkTarget.DUES_SCHEDULE, schedule.id)
        service = ZeffySyncService(db_session)
        await service.record_payment(
            org_id, "pay_1", zeffy_payment(amount=12000, email="dana@fd.test")
        )

        row = await service.record_payment(
            org_id,
            "pay_1",
            zeffy_payment(
                amount=12000,
                email="dana@fd.test",
                refunds=refunded(12000),
                refund_status="full",
            ),
        )

        assert row is not None
        assert row.state == ZeffyPaymentState.NEEDS_REVIEW
        await db_session.refresh(dues)
        assert dues.amount_paid == Decimal("120.00")

    async def test_a_payer_who_is_not_a_member_is_left_unmatched(self, db_session, org):
        org_id, officer_id = org
        member_id = await _member(db_session, org_id, "dana@fd.test")
        schedule, dues = await _dues(db_session, org_id, officer_id, member_id)
        await _link(db_session, org_id, ZeffyLinkTarget.DUES_SCHEDULE, schedule.id)

        row = await ZeffySyncService(db_session).record_payment(
            org_id, "pay_1", zeffy_payment(amount=12000, email="stranger@else.test")
        )

        assert row is not None
        assert row.state == ZeffyPaymentState.UNMATCHED
        await db_session.refresh(dues)
        assert dues.amount_paid == Decimal("0.00")

    async def test_a_member_from_another_department_is_not_matched(
        self, db_session, org
    ):
        org_id, officer_id = org
        own_member = await _member(db_session, org_id, "dana@fd.test")
        schedule, _ = await _dues(db_session, org_id, officer_id, own_member)
        await _link(db_session, org_id, ZeffyLinkTarget.DUES_SCHEDULE, schedule.id)
        other_org = await _org(db_session)
        await _member(db_session, other_org, "outsider@fd.test")

        row = await ZeffySyncService(db_session).record_payment(
            org_id, "pay_1", zeffy_payment(amount=12000, email="outsider@fd.test")
        )

        assert row is not None
        assert row.state == ZeffyPaymentState.UNMATCHED


# ---------------------------------------------------------------------------
# Polling
# ---------------------------------------------------------------------------


class _FakeZeffy:
    """Answers list_payments_page from a function of the request."""

    def __init__(self, pages=None, raise_after: int | None = None):
        self.calls: list[dict] = []
        self._pages = pages or (lambda call: {"data": [], "has_more": False})
        self._raise_after = raise_after

    async def list_payments_page(self, **kwargs):
        if self._raise_after is not None and len(self.calls) >= self._raise_after:
            raise ZeffyRateLimited(60)
        self.calls.append(kwargs)
        return self._pages(kwargs)


async def _integration(db: AsyncSession, org_id: str) -> Integration:
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
    await db.refresh(integration)
    return integration


class TestSync:
    async def test_reads_each_window_and_records_what_it_finds(self, db_session, org):
        org_id, _ = org
        campaign = await _campaign(db_session, org_id)
        start = PAID - timedelta(days=45)
        link = await _link(
            db_session,
            org_id,
            ZeffyLinkTarget.FUNDRAISING_CAMPAIGN,
            campaign.id,
            apply_from=start,
        )
        integration = await _integration(db_session, org_id)

        def pages(call):
            gte, lt = call["created_gte"], call["created_lt"]
            inside = gte <= int(PAID.timestamp()) < lt
            return {"data": [zeffy_payment()] if inside else [], "has_more": False}

        fake = _FakeZeffy(pages)
        now = PAID + timedelta(days=1)
        counts = await ZeffySyncService(db_session).sync_integration(
            integration, now=now, client=fake
        )

        assert counts["complete"] is True
        assert counts["payments_read"] == 1
        assert [c["campaign_id"] for c in fake.calls] == ["camp_1", "camp_1"]
        assert fake.calls[0]["created_gte"] == int(start.timestamp())
        assert fake.calls[0]["created_lt"] == int((start + SYNC_WINDOW).timestamp())
        assert fake.calls[-1]["created_lt"] == int(now.timestamp())
        await db_session.refresh(link)
        assert link.synced_through is not None
        assert link.synced_through.replace(tzinfo=timezone.utc) == now
        assert len(await _donations(db_session, org_id)) == 1

    async def test_a_rate_limit_keeps_progress_up_to_the_last_full_window(
        self, db_session, org
    ):
        org_id, _ = org
        campaign = await _campaign(db_session, org_id)
        start = PAID - timedelta(days=90)
        link = await _link(
            db_session,
            org_id,
            ZeffyLinkTarget.FUNDRAISING_CAMPAIGN,
            campaign.id,
            apply_from=start,
        )
        integration = await _integration(db_session, org_id)

        counts = await ZeffySyncService(db_session).sync_integration(
            integration, now=PAID, client=_FakeZeffy(raise_after=1)
        )

        assert counts["complete"] is False
        assert counts["rate_limited"] is True
        await db_session.refresh(link)
        assert link.synced_through is not None
        assert link.synced_through.replace(tzinfo=timezone.utc) == start + SYNC_WINDOW

    async def test_the_next_run_starts_a_week_behind_where_it_got_to(
        self, db_session, org
    ):
        org_id, _ = org
        campaign = await _campaign(db_session, org_id)
        link = await _link(
            db_session, org_id, ZeffyLinkTarget.FUNDRAISING_CAMPAIGN, campaign.id
        )
        link.synced_through = PAID
        await db_session.flush()
        integration = await _integration(db_session, org_id)

        fake = _FakeZeffy()
        await ZeffySyncService(db_session).sync_integration(
            integration, now=PAID + timedelta(days=1), client=fake
        )

        assert fake.calls[0]["created_gte"] == int(
            (PAID - timedelta(days=7)).timestamp()
        )


# ---------------------------------------------------------------------------
# Webhook
# ---------------------------------------------------------------------------

SECRET = "whsec_zeffy_test"


def _request(payload: dict, secret: str = SECRET, signed_at: int | None = None):
    body = json.dumps(payload).encode()
    t = signed_at if signed_at is not None else int(time.time())
    digest = hmac.new(secret.encode(), f"{t}.".encode() + body, hashlib.sha256)
    request = MagicMock()
    request.body = AsyncMock(return_value=body)
    request.json = AsyncMock(return_value=payload)
    request.headers = {"zeffy-signature": f"t={t},v1={digest.hexdigest()}"}
    return request


async def _webhook_integration(db: AsyncSession, org_id: str) -> Integration:
    integration = await _integration(db, org_id)
    integration.set_secret("webhook_secret", SECRET)
    await db.flush()
    return integration


def _webhook_event(
    event_type: str = "payment.updated", payment_id: str = "pay_1"
) -> dict:
    return {
        "id": f"evt_{uuid.uuid4().hex[:8]}",
        "type": event_type,
        "version": 1,
        "data": {"id": payment_id, "object": "payment"},
    }


class TestWebhook:
    async def test_a_signed_event_records_the_payment_as_zeffy_reports_it(
        self, db_session, org
    ):
        org_id, _ = org
        campaign = await _campaign(db_session, org_id)
        await _link(
            db_session, org_id, ZeffyLinkTarget.FUNDRAISING_CAMPAIGN, campaign.id
        )
        integration = await _webhook_integration(db_session, org_id)

        with patch.object(
            zeffy_webhook.ZeffyClient,
            "get_payment",
            AsyncMock(return_value=zeffy_payment()),
        ) as get_payment:
            result = await zeffy_webhook.zeffy_inbound_webhook(
                integration.id, _request(_webhook_event()), db=db_session, _rl=None
            )

        get_payment.assert_awaited_once_with("pay_1")
        assert result == {"status": "received", "state": "applied"}
        assert len(await _donations(db_session, org_id)) == 1

    async def test_a_bad_signature_is_refused_before_anything_is_read(
        self, db_session, org
    ):
        org_id, _ = org
        integration = await _webhook_integration(db_session, org_id)

        with patch.object(
            zeffy_webhook.ZeffyClient, "get_payment", AsyncMock()
        ) as get_payment:
            with pytest.raises(HTTPException) as caught:
                await zeffy_webhook.zeffy_inbound_webhook(
                    integration.id,
                    _request(_webhook_event(), secret="whsec_forged"),
                    db=db_session,
                    _rl=None,
                )

        assert caught.value.status_code == 401
        get_payment.assert_not_awaited()

    async def test_without_a_signing_secret_every_delivery_is_refused(
        self, db_session, org
    ):
        org_id, _ = org
        integration = await _integration(db_session, org_id)

        with pytest.raises(HTTPException) as caught:
            await zeffy_webhook.zeffy_inbound_webhook(
                integration.id, _request(_webhook_event()), db=db_session, _rl=None
            )
        assert caught.value.status_code == 401

    async def test_a_contact_event_is_acknowledged_and_ignored(self, db_session, org):
        org_id, _ = org
        integration = await _webhook_integration(db_session, org_id)

        result = await zeffy_webhook.zeffy_inbound_webhook(
            integration.id,
            _request(_webhook_event("contact.updated")),
            db=db_session,
            _rl=None,
        )
        assert result["status"] == "ignored"

    async def test_zeffy_unreachable_answers_503_so_it_retries(self, db_session, org):
        org_id, _ = org
        integration = await _webhook_integration(db_session, org_id)

        with patch.object(
            zeffy_webhook.ZeffyClient,
            "get_payment",
            AsyncMock(side_effect=ZeffyRateLimited(60)),
        ):
            with pytest.raises(HTTPException) as caught:
                await zeffy_webhook.zeffy_inbound_webhook(
                    integration.id, _request(_webhook_event()), db=db_session, _rl=None
                )
        assert caught.value.status_code == 503

    async def test_an_unknown_integration_is_404(self, db_session, org):
        with pytest.raises(HTTPException) as caught:
            await zeffy_webhook.zeffy_inbound_webhook(
                str(uuid.uuid4()), _request(_webhook_event()), db=db_session, _rl=None
            )
        assert caught.value.status_code == 404

    async def test_a_redelivered_event_applies_nothing_more(self, db_session, org):
        org_id, _ = org
        campaign = await _campaign(db_session, org_id)
        await _link(
            db_session, org_id, ZeffyLinkTarget.FUNDRAISING_CAMPAIGN, campaign.id
        )
        integration = await _webhook_integration(db_session, org_id)
        event = _webhook_event("payment.completed")

        with patch.object(
            zeffy_webhook.ZeffyClient,
            "get_payment",
            AsyncMock(return_value=zeffy_payment()),
        ):
            for _ in range(2):
                await zeffy_webhook.zeffy_inbound_webhook(
                    integration.id, _request(event), db=db_session, _rl=None
                )

        assert len(await _donations(db_session, org_id)) == 1
        rows = (
            await db_session.scalars(
                select(ZeffyPayment).where(ZeffyPayment.organization_id == org_id)
            )
        ).all()
        assert len(rows) == 1


# ---------------------------------------------------------------------------
# Review round 2: races, fairness, resumability
# ---------------------------------------------------------------------------


class TestStaleSnapshots:
    async def test_an_older_read_after_a_refund_does_not_restore_the_donation(
        self, db_session, org
    ):
        org_id, _ = org
        campaign = await _campaign(db_session, org_id)
        await _link(
            db_session, org_id, ZeffyLinkTarget.FUNDRAISING_CAMPAIGN, campaign.id
        )
        service = ZeffySyncService(db_session)
        await service.record_payment(org_id, "pay_1", zeffy_payment())
        await service.record_payment(
            org_id,
            "pay_1",
            zeffy_payment(refunds=refunded(5000), refund_status="full"),
        )

        # A sync page read before the refund, applied after it.
        row = await service.record_payment(org_id, "pay_1", zeffy_payment())

        assert row is not None
        assert row.state == ZeffyPaymentState.REVERSED
        (donation,) = await _donations(db_session, org_id)
        assert donation.payment_status == PaymentStatus.REFUNDED
        await db_session.refresh(campaign)
        assert campaign.current_amount == Decimal("0.00")

    async def test_an_older_read_after_a_partial_refund_keeps_the_lower_amount(
        self, db_session, org
    ):
        org_id, _ = org
        event = await _event(db_session, org_id)
        await _link(db_session, org_id, ZeffyLinkTarget.FUNDRAISING_EVENT, event.id)
        service = ZeffySyncService(db_session)
        await service.record_payment(
            org_id, "pay_1", zeffy_payment(amount=4000, tickets=2)
        )
        await service.record_payment(
            org_id,
            "pay_1",
            zeffy_payment(
                amount=4000, tickets=2, refunds=refunded(1000), refund_status="partial"
            ),
        )

        await service.record_payment(
            org_id, "pay_1", zeffy_payment(amount=4000, tickets=2)
        )

        await db_session.refresh(event)
        assert event.actual_revenue == Decimal("130.00")

    async def test_a_deleted_payment_stays_deleted(self, db_session, org):
        org_id, _ = org
        campaign = await _campaign(db_session, org_id)
        await _link(
            db_session, org_id, ZeffyLinkTarget.FUNDRAISING_CAMPAIGN, campaign.id
        )
        service = ZeffySyncService(db_session)
        await service.record_payment(org_id, "pay_1", zeffy_payment())
        await service.record_payment(org_id, "pay_1", None)

        row = await service.record_payment(org_id, "pay_1", zeffy_payment())

        assert row is not None
        assert row.deleted_in_zeffy
        assert row.state == ZeffyPaymentState.REVERSED

    async def test_a_newer_state_is_still_applied(self, db_session, org):
        org_id, _ = org
        campaign = await _campaign(db_session, org_id)
        await _link(
            db_session, org_id, ZeffyLinkTarget.FUNDRAISING_CAMPAIGN, campaign.id
        )
        service = ZeffySyncService(db_session)
        await service.record_payment(org_id, "pay_1", zeffy_payment(status="pending"))

        row = await service.record_payment(org_id, "pay_1", zeffy_payment())

        assert row is not None
        assert row.state == ZeffyPaymentState.APPLIED


class TestDuesSelection:
    async def test_two_payments_settle_two_open_dues_rather_than_donating(
        self, db_session, org
    ):
        org_id, officer_id = org
        member_id = await _member(db_session, org_id, "dana@fd.test")
        schedule, first = await _dues(db_session, org_id, officer_id, member_id)
        second = MemberDues(
            organization_id=org_id,
            dues_schedule_id=schedule.id,
            user_id=member_id,
            amount_due=Decimal("120.00"),
            amount_paid=Decimal("0.00"),
            status=DuesStatus.PENDING,
            due_date=first.due_date + timedelta(days=365),
        )
        db_session.add(second)
        await db_session.flush()
        await _link(db_session, org_id, ZeffyLinkTarget.DUES_SCHEDULE, schedule.id)
        service = ZeffySyncService(db_session)

        for payment_id in ("pay_1", "pay_2"):
            await service.record_payment(
                org_id,
                payment_id,
                zeffy_payment(payment_id, amount=12000, email="dana@fd.test"),
            )

        await db_session.refresh(first)
        await db_session.refresh(second)
        assert first.status == DuesStatus.PAID
        assert second.status == DuesStatus.PAID
        assert await _donations(db_session, org_id) == []

    async def test_the_open_dues_are_chosen_with_a_locking_read(self, db_session, org):
        org_id, officer_id = org
        member_id = await _member(db_session, org_id, "dana@fd.test")
        schedule, _ = await _dues(db_session, org_id, officer_id, member_id)
        await _link(db_session, org_id, ZeffyLinkTarget.DUES_SCHEDULE, schedule.id)
        service = ZeffySyncService(db_session)
        statements = []
        real_scalar = db_session.scalar

        async def capture(statement, *args, **kwargs):
            statements.append(statement)
            return await real_scalar(statement, *args, **kwargs)

        with patch.object(db_session, "scalar", side_effect=capture):
            await service.record_payment(
                org_id, "pay_1", zeffy_payment(amount=12000, email="dana@fd.test")
            )

        dues_reads = [
            s
            for s in statements
            if "member_dues" in str(s) and "dues_schedule_id" in str(s)
        ]
        assert dues_reads
        assert all(s._for_update_arg is not None for s in dues_reads)


class TestRetryFairness:
    async def test_payments_before_a_start_date_do_not_fill_the_hourly_batch(
        self, db_session, org
    ):
        org_id, officer_id = org
        campaign = await _campaign(db_session, org_id)
        await _link(
            db_session,
            org_id,
            ZeffyLinkTarget.FUNDRAISING_CAMPAIGN,
            campaign.id,
            apply_from=PAID + timedelta(days=1),
        )
        service = ZeffySyncService(db_session)
        for i in range(3):
            # Older than the payment that can be settled, so a batch taken
            # oldest-first would be all of these.
            await service.record_payment(
                org_id,
                f"old_{i}",
                zeffy_payment(f"old_{i}", paid_at=PAID - timedelta(days=30)),
            )

        member_id = await _member(db_session, org_id, "late@fd.test")
        schedule, dues = await _dues(db_session, org_id, officer_id, member_id)
        await _link(
            db_session,
            org_id,
            ZeffyLinkTarget.DUES_SCHEDULE,
            schedule.id,
            campaign_id="camp_m",
        )
        waiting = await service.record_payment(
            org_id,
            "pay_m",
            zeffy_payment(
                "pay_m", campaign_id="camp_m", amount=12000, email="nobody@fd.test"
            ),
        )
        assert waiting is not None
        assert waiting.state == ZeffyPaymentState.UNMATCHED
        await db_session.execute(
            text("UPDATE users SET email_hash = :h WHERE id = :i"),
            {"h": email_fingerprint("nobody@fd.test"), "i": member_id},
        )

        applied = await service.retry_unapplied(org_id, limit=1)

        assert applied == 1
        await db_session.refresh(dues)
        assert dues.status == DuesStatus.PAID

    async def test_a_batch_that_stays_unmatched_rotates_to_the_back(
        self, db_session, org
    ):
        org_id, officer_id = org
        member_id = await _member(db_session, org_id, "dana@fd.test")
        schedule, _ = await _dues(db_session, org_id, officer_id, member_id)
        await _link(db_session, org_id, ZeffyLinkTarget.DUES_SCHEDULE, schedule.id)
        service = ZeffySyncService(db_session)
        for payment_id in ("pay_a", "pay_b"):
            await service.record_payment(
                org_id,
                payment_id,
                zeffy_payment(payment_id, amount=100, email="stranger@else.test"),
            )
        rows = {
            r.zeffy_payment_id: r
            for r in (
                await db_session.scalars(
                    select(ZeffyPayment).where(ZeffyPayment.organization_id == org_id)
                )
            ).all()
        }
        rows["pay_a"].last_event_at = PAID
        rows["pay_b"].last_event_at = PAID + timedelta(minutes=1)
        await db_session.flush()

        await service.retry_unapplied(org_id, limit=1)
        await service.retry_unapplied(org_id, limit=1)

        examined = {
            pid: row.last_event_at.replace(tzinfo=timezone.utc)
            for pid, row in rows.items()
        }
        assert examined["pay_a"] > PAID + timedelta(days=1)
        assert examined["pay_b"] > PAID + timedelta(days=1)


class TestSyncFairnessAndResume:
    async def test_the_least_recently_synced_link_goes_first(self, db_session, org):
        org_id, _ = org
        campaign = await _campaign(db_session, org_id)
        recent = await _link(
            db_session,
            org_id,
            ZeffyLinkTarget.FUNDRAISING_CAMPAIGN,
            campaign.id,
            campaign_id="camp_recent",
        )
        recent.synced_through = PAID
        stale = await _link(
            db_session,
            org_id,
            ZeffyLinkTarget.FUNDRAISING_CAMPAIGN,
            campaign.id,
            campaign_id="camp_stale",
        )
        stale.synced_through = PAID - timedelta(days=2)
        # Created after the other, so creation order alone would pick the
        # recently synced link first.
        recent.created_at = PAID - timedelta(days=10)
        stale.created_at = PAID
        await db_session.flush()
        integration = await _integration(db_session, org_id)

        fake = _FakeZeffy(raise_after=1)
        await ZeffySyncService(db_session).sync_integration(
            integration, now=PAID + timedelta(hours=1), client=fake
        )

        assert [c["campaign_id"] for c in fake.calls] == ["camp_stale"]

    async def test_a_window_too_big_for_one_run_resumes_on_the_next_page(
        self, db_session, org
    ):
        org_id, _ = org
        campaign = await _campaign(db_session, org_id)
        start = PAID - timedelta(days=10)
        link = await _link(
            db_session,
            org_id,
            ZeffyLinkTarget.FUNDRAISING_CAMPAIGN,
            campaign.id,
            apply_from=start,
        )
        integration = await _integration(db_session, org_id)

        def pages(call):
            after = call.get("starting_after")
            n = 0 if after is None else int(after.split("_")[1]) + 1
            return {
                "data": [zeffy_payment(f"pay_{n}")],
                "has_more": n < 2,
                "next_cursor": f"pay_{n}",
            }

        service = ZeffySyncService(db_session)
        first = _FakeZeffy(pages)
        with patch("app.services.zeffy_sync_service.MAX_REQUESTS_PER_RUN", 2):
            counts = await service.sync_integration(integration, now=PAID, client=first)
        assert counts["complete"] is False
        await db_session.refresh(link)
        assert link.sync_cursor == "pay_1"
        assert link.sync_window_end.replace(tzinfo=timezone.utc) == PAID
        assert link.synced_through is None

        second = _FakeZeffy(pages)
        counts = await service.sync_integration(
            integration, now=PAID + timedelta(hours=1), client=second
        )

        assert second.calls[0]["starting_after"] == "pay_1"
        assert second.calls[0]["created_gte"] == int(start.timestamp())
        assert second.calls[0]["created_lt"] == int(PAID.timestamp())
        await db_session.refresh(link)
        assert link.sync_cursor is None
        assert link.sync_window_end is None
        ids = (
            await db_session.scalars(
                select(ZeffyPayment.zeffy_payment_id).where(
                    ZeffyPayment.organization_id == org_id
                )
            )
        ).all()
        assert sorted(ids) == ["pay_0", "pay_1", "pay_2"]

    async def test_a_rate_limit_mid_window_keeps_its_place(self, db_session, org):
        org_id, _ = org
        campaign = await _campaign(db_session, org_id)
        link = await _link(
            db_session,
            org_id,
            ZeffyLinkTarget.FUNDRAISING_CAMPAIGN,
            campaign.id,
            apply_from=PAID - timedelta(days=10),
        )
        integration = await _integration(db_session, org_id)

        def pages(call):
            return {"data": [zeffy_payment()], "has_more": True, "next_cursor": "c1"}

        await ZeffySyncService(db_session).sync_integration(
            integration, now=PAID, client=_FakeZeffy(pages, raise_after=1)
        )

        await db_session.refresh(link)
        assert link.sync_cursor == "c1"


class TestWebhookAudit:
    async def test_the_audit_record_carries_the_organization(self, db_session, org):
        from app.models.audit import AuditLog

        org_id, _ = org
        integration = await _webhook_integration(db_session, org_id)

        with patch.object(
            zeffy_webhook.ZeffyClient,
            "get_payment",
            AsyncMock(return_value=zeffy_payment()),
        ):
            await zeffy_webhook.zeffy_inbound_webhook(
                integration.id, _request(_webhook_event()), db=db_session, _rl=None
            )

        logged = (
            await db_session.scalars(
                select(AuditLog).where(AuditLog.event_type == "zeffy_payment_received")
            )
        ).all()
        assert [str(a.organization_id) for a in logged][-1:] == [org_id]
