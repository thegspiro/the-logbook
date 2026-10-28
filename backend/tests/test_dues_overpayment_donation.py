"""A dues overpayment is warned about, and the excess becomes a donation.

W66-3, owner decision 2026-10-27: recording $75 against a $70 balance used to
be accepted silently, leaving "$125.00 paid of $120.00" with the extra $5
counted as dues collected. Now an overpayment is refused unless the officer
confirms it; when they do, the dues are settled at the balance and the $5 is a
Fundraising donation from the member, under no campaign.

Integration: the donor lookup, the donation and the retry check are SQL.
"""

import uuid
from datetime import datetime, timedelta, timezone
from decimal import Decimal

import pytest
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.finance import DuesFrequency, DuesSchedule, DuesStatus, MemberDues
from app.models.grant import Donation, Donor, DonorType, PaymentMethod
from app.services.finance_service import FinanceService

pytestmark = [pytest.mark.integration]


async def _member(db: AsyncSession, org_id: str) -> str:
    member_id = str(uuid.uuid4())
    await db.execute(
        text(
            "INSERT INTO users (id, organization_id, username, first_name, "
            "last_name, email, password_hash, status) VALUES (:id, :org, :un, "
            "'Dana', 'Member', :em, 'x', 'active')"
        ),
        {
            "id": member_id,
            "org": org_id,
            "un": f"dana-{member_id[:8]}",
            "em": f"dana-{member_id[:8]}@fd.test",
        },
    )
    return member_id


async def _dues(
    db: AsyncSession, org_id: str, officer_id: str, member_id: str, paid: str = "50"
) -> MemberDues:
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
    if Decimal(paid):
        await FinanceService(db).record_dues_payment(
            dues.id, org_id, recorded_by=officer_id, amount_paid=Decimal(paid)
        )
    return dues


async def _donations(db: AsyncSession, org_id: str) -> list[Donation]:
    return list(
        (
            await db.scalars(select(Donation).where(Donation.organization_id == org_id))
        ).all()
    )


@pytest.fixture
async def scene(db_session: AsyncSession, setup_org_and_admin):
    org_id, officer_id = setup_org_and_admin
    member_id = await _member(db_session, org_id)
    dues = await _dues(db_session, org_id, officer_id, member_id)
    return org_id, officer_id, member_id, dues


async def test_an_unconfirmed_overpayment_is_refused(db_session, scene):
    org_id, officer_id, _, dues = scene

    with pytest.raises(ValueError, match=r"\$5\.00 more than the \$70\.00"):
        await FinanceService(db_session).record_dues_payment(
            dues.id, org_id, recorded_by=officer_id, amount_paid=Decimal("75")
        )

    assert dues.amount_paid == Decimal("50.00")
    assert await _donations(db_session, org_id) == []


async def test_a_confirmed_overpayment_settles_the_dues_and_donates_the_rest(
    db_session, scene
):
    org_id, officer_id, member_id, dues = scene

    await FinanceService(db_session).record_dues_payment(
        dues.id,
        org_id,
        recorded_by=officer_id,
        amount_paid=Decimal("75"),
        payment_method="check",
        transaction_reference="CHK-1042",
        excess_as_donation=True,
    )

    assert (dues.amount_paid, dues.status) == (Decimal("120.00"), DuesStatus.PAID)
    assert dues.payments[-1].amount == Decimal("70.00")
    assert "recorded as a donation" in (dues.payments[-1].notes or "")
    [donation] = await _donations(db_session, org_id)
    assert donation.amount == Decimal("5.00")
    assert donation.campaign_id is None
    assert donation.payment_method == PaymentMethod.CHECK
    assert donation.transaction_id == "CHK-1042"
    donor = await db_session.get(Donor, donation.donor_id)
    assert (donor.user_id, donor.donor_type) == (member_id, DonorType.INDIVIDUAL)
    assert (donor.first_name, donor.last_name) == ("Dana", "Member")


async def test_the_members_existing_donor_record_is_used(db_session, scene):
    org_id, officer_id, member_id, dues = scene
    existing = Donor(
        organization_id=org_id,
        user_id=member_id,
        donor_type=DonorType.INDIVIDUAL,
        first_name="Dana",
        last_name="Member",
    )
    db_session.add(existing)
    await db_session.flush()

    await FinanceService(db_session).record_dues_payment(
        dues.id,
        org_id,
        recorded_by=officer_id,
        amount_paid=Decimal("80"),
        excess_as_donation=True,
    )

    [donation] = await _donations(db_session, org_id)
    assert (donation.donor_id, donation.amount) == (existing.id, Decimal("10.00"))
    assert donation.payment_method == PaymentMethod.OTHER


async def test_a_payment_on_dues_already_paid_is_all_donation(
    db_session, setup_org_and_admin
):
    org_id, officer_id = setup_org_and_admin
    member_id = await _member(db_session, org_id)
    dues = await _dues(db_session, org_id, officer_id, member_id, paid="120")
    service = FinanceService(db_session)

    for _ in range(2):  # the second is a retried submission
        await service.record_dues_payment(
            dues.id,
            org_id,
            recorded_by=officer_id,
            amount_paid=Decimal("20"),
            transaction_reference="CASH-7",
            excess_as_donation=True,
        )

    assert dues.amount_paid == Decimal("120.00")
    assert len(dues.payments) == 1
    [donation] = await _donations(db_session, org_id)
    assert donation.amount == Decimal("20.00")


async def test_an_exact_payment_needs_no_confirmation(db_session, scene):
    org_id, officer_id, _, dues = scene

    await FinanceService(db_session).record_dues_payment(
        dues.id, org_id, recorded_by=officer_id, amount_paid=Decimal("70")
    )

    assert dues.status == DuesStatus.PAID
    assert await _donations(db_session, org_id) == []
