"""A donation can pay toward a pledge, and the pledge follows it.

Owner decision, 2026-11-01 ("Grants & Fundraising — Pledges and Fundraising
Events": link donations to pledges). Pinned here:

* a donation names an open pledge of this department and of the same donor;
  a pledge of another department reads as not found (#14c), a pledge of
  another donor, a fulfilled one or a cancelled one is refused;
* recording a completed gift adds its amount to the pledge's fulfilled
  amount and settles the status (partial, then fulfilled); a pending gift
  counts for nothing until it completes;
* editing moves the difference: a new amount, a refund, unlinking, or moving
  the gift to another pledge gives the old pledge its share back;
* a hand-entered fulfilled amount from before the link is kept and added to;
* the pledges are read under a row lock (#27), and an anonymous gift's
  pledge is hidden from a view-only caller, as its donor is.
"""

import uuid
from datetime import date, datetime, timezone
from decimal import Decimal
from unittest.mock import AsyncMock, MagicMock

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.grant import Pledge, PledgeStatus
from app.models.user import Organization, User
from app.schemas.grant import DonationCreate, DonationUpdate
from app.services.donor_privacy import present_donation
from app.services.fundraising_service import (
    FundraisingService,
    pledge_share,
    pledge_status_after,
)

# ============================================
# The arithmetic, no database
# ============================================


@pytest.mark.unit
class TestPledgeStatusAfter:
    @pytest.mark.parametrize(
        ("status", "fulfilled", "expected"),
        [
            (PledgeStatus.PENDING, "0", PledgeStatus.PENDING),
            (PledgeStatus.PENDING, "100", PledgeStatus.PARTIAL),
            (PledgeStatus.PARTIAL, "500", PledgeStatus.FULFILLED),
            (PledgeStatus.PARTIAL, "600", PledgeStatus.FULFILLED),
            (PledgeStatus.FULFILLED, "200", PledgeStatus.PARTIAL),
            (PledgeStatus.FULFILLED, "0", PledgeStatus.PENDING),
            (PledgeStatus.OVERDUE, "200", PledgeStatus.OVERDUE),
            (PledgeStatus.OVERDUE, "500", PledgeStatus.FULFILLED),
            (PledgeStatus.CANCELLED, "500", PledgeStatus.CANCELLED),
        ],
    )
    def test_settles_on_the_amount_in(self, status, fulfilled, expected):
        assert pledge_status_after(status, Decimal(fulfilled), Decimal("500")) == (
            expected
        )

    def test_only_a_completed_linked_gift_counts(self):
        assert pledge_share("p", Decimal("50"), "completed") == Decimal("50")
        assert pledge_share("p", Decimal("50"), "pending") == 0
        assert pledge_share("p", Decimal("50"), "refunded") == 0
        assert pledge_share(None, Decimal("50"), "completed") == 0

    async def test_the_pledges_are_read_under_a_row_lock(self):
        db = MagicMock()
        result = MagicMock()
        result.scalars.return_value.all.return_value = []
        db.execute = AsyncMock(return_value=result)
        await FundraisingService(db)._lock_pledges(["b", "a", None], "org")
        statement = db.execute.await_args.args[0]
        assert statement._for_update_arg is not None
        assert "organization_id" in str(statement)

    def test_an_anonymous_gifts_pledge_is_hidden_from_a_viewer(self):
        now = datetime(2026, 11, 6, tzinfo=timezone.utc)
        row = {
            "id": uuid.uuid4(),
            "organization_id": uuid.uuid4(),
            "pledge_id": uuid.uuid4(),
            "donor_id": uuid.uuid4(),
            "amount": Decimal("10"),
            "donation_date": now,
            "payment_method": "cash",
            "is_anonymous": True,
            "created_at": now,
            "updated_at": now,
        }
        assert present_donation(row, can_see_identity=False).pledge_id is None
        assert present_donation(row, can_see_identity=True).pledge_id is not None


# ============================================
# Against the database
# ============================================


async def _org(db: AsyncSession, label: str) -> str:
    org = Organization(
        id=str(uuid.uuid4()),
        name=f"{label} VFD",
        slug=f"pledge-{label}-{uuid.uuid4().hex[:8]}",
        timezone="UTC",
    )
    db.add(org)
    await db.flush()
    return org.id


@pytest.fixture
async def dept(db_session: AsyncSession):
    org_id = await _org(db_session, "home")
    other_org = await _org(db_session, "away")
    name = f"treasurer-{uuid.uuid4().hex[:8]}"
    user = User(
        organization_id=org_id,
        username=name,
        first_name="Tess",
        last_name="Park",
        email=f"{name}@example.com",
    )
    db_session.add(user)
    await db_session.flush()
    service = FundraisingService(db_session)
    maria = await service.create_donor(
        org_id, {"first_name": "Maria", "last_name": "Lopez"}
    )
    sam = await service.create_donor(org_id, {"first_name": "Sam", "last_name": "Ito"})
    their_donor = await service.create_donor(
        other_org, {"first_name": "Their", "last_name": "Donor"}
    )

    async def pledge(org=org_id, donor=maria.id, amount="500", **kw):
        return await service.create_pledge(
            org,
            {
                "pledged_amount": Decimal(amount),
                "pledge_date": date(2026, 10, 1),
                "donor_id": donor,
                **kw,
            },
            user.id,
        )

    return {
        "service": service,
        "org_id": org_id,
        "other_org": other_org,
        "user_id": user.id,
        "maria": maria.id,
        "sam": sam.id,
        "their_donor": their_donor.id,
        "pledge": pledge,
    }


async def _give(dept, pledge_id, amount="100", donor="maria", **extra):
    body = {
        "amount": amount,
        "donation_date": "2026-11-06T12:00:00Z",
        "payment_method": "check",
        "donor_id": dept[donor] if donor else None,
        "pledge_id": pledge_id,
        **extra,
    }
    data = DonationCreate.model_validate(body).model_dump(exclude_unset=True)
    return await dept["service"].create_donation(dept["org_id"], data, dept["user_id"])


async def _edit(dept, donation_id, **fields):
    data = DonationUpdate.model_validate(fields).model_dump(exclude_unset=True)
    return await dept["service"].update_donation(donation_id, dept["org_id"], data)


async def _reload(db, pledge_id) -> Pledge:
    pledge = await db.get(Pledge, pledge_id)
    await db.refresh(pledge)
    return pledge


@pytest.mark.integration
class TestRecordingAGiftAgainstAPledge:
    async def test_a_completed_gift_is_counted_and_the_status_follows(
        self, db_session, dept
    ):
        pledge = await dept["pledge"]()
        gift = await _give(dept, pledge.id, "200")
        assert gift.pledge_id == pledge.id
        pledge = await _reload(db_session, pledge.id)
        assert pledge.fulfilled_amount == Decimal("200.00")
        assert pledge.status == PledgeStatus.PARTIAL
        await _give(dept, pledge.id, "300")
        pledge = await _reload(db_session, pledge.id)
        assert pledge.fulfilled_amount == Decimal("500.00")
        assert pledge.status == PledgeStatus.FULFILLED

    async def test_a_pending_gift_counts_once_it_completes(self, db_session, dept):
        pledge = await dept["pledge"]()
        gift = await _give(dept, pledge.id, "200", payment_status="pending")
        assert (await _reload(db_session, pledge.id)).fulfilled_amount == 0
        await _edit(dept, gift.id, payment_status="completed")
        assert (await _reload(db_session, pledge.id)).fulfilled_amount == Decimal(
            "200.00"
        )

    async def test_a_hand_entered_amount_is_kept_and_added_to(self, db_session, dept):
        pledge = await dept["pledge"]()
        await dept["service"].update_pledge(
            pledge.id,
            dept["org_id"],
            {"fulfilled_amount": Decimal("150"), "status": "partial"},
        )
        await _give(dept, pledge.id, "100")
        assert (await _reload(db_session, pledge.id)).fulfilled_amount == Decimal(
            "250.00"
        )

    async def test_a_pledge_with_no_donor_takes_anyones_gift(self, db_session, dept):
        pledge = await dept["pledge"](donor=None)
        await _give(dept, pledge.id, "50", donor="sam")
        assert (await _reload(db_session, pledge.id)).fulfilled_amount == Decimal(
            "50.00"
        )


@pytest.mark.integration
class TestWhichPledgeAGiftMayName:
    async def test_another_departments_pledge_is_not_found(self, dept):
        theirs = await dept["pledge"](org=dept["other_org"], donor=dept["their_donor"])
        with pytest.raises(ValueError, match="Pledge not found"):
            await _give(dept, theirs.id)

    async def test_another_donors_pledge_is_refused(self, dept):
        pledge = await dept["pledge"]()
        with pytest.raises(ValueError, match="different donor"):
            await _give(dept, pledge.id, donor="sam")
        with pytest.raises(ValueError, match="different donor"):
            await _give(dept, pledge.id, donor=None)

    @pytest.mark.parametrize("status", ["fulfilled", "cancelled"])
    async def test_a_closed_pledge_takes_no_new_gift(self, dept, status):
        pledge = await dept["pledge"]()
        await dept["service"].update_pledge(
            pledge.id, dept["org_id"], {"status": status}
        )
        with pytest.raises(ValueError, match="open pledge"):
            await _give(dept, pledge.id)

    async def test_moving_the_gift_to_another_donor_is_refused(self, dept):
        pledge = await dept["pledge"]()
        gift = await _give(dept, pledge.id)
        with pytest.raises(ValueError, match="different donor"):
            await _edit(dept, gift.id, donor_id=dept["sam"])


@pytest.mark.integration
class TestEditingALinkedGift:
    async def test_a_new_amount_moves_the_difference(self, db_session, dept):
        pledge = await dept["pledge"]()
        gift = await _give(dept, pledge.id, "500")
        assert (await _reload(db_session, pledge.id)).status == PledgeStatus.FULFILLED
        await _edit(dept, gift.id, amount="350")
        pledge = await _reload(db_session, pledge.id)
        assert pledge.fulfilled_amount == Decimal("350.00")
        assert pledge.status == PledgeStatus.PARTIAL

    async def test_a_refund_gives_the_amount_back(self, db_session, dept):
        pledge = await dept["pledge"]()
        gift = await _give(dept, pledge.id, "200")
        await _edit(dept, gift.id, payment_status="refunded")
        pledge = await _reload(db_session, pledge.id)
        assert pledge.fulfilled_amount == 0
        assert pledge.status == PledgeStatus.PENDING

    async def test_unlinking_gives_the_amount_back(self, db_session, dept):
        pledge = await dept["pledge"]()
        gift = await _give(dept, pledge.id, "200")
        edited = await _edit(dept, gift.id, pledge_id=None)
        assert edited.pledge_id is None
        assert (await _reload(db_session, pledge.id)).fulfilled_amount == 0

    async def test_moving_to_another_pledge_moves_the_share(self, db_session, dept):
        first = await dept["pledge"]()
        second = await dept["pledge"](amount="200")
        gift = await _give(dept, first.id, "200")
        await _edit(dept, gift.id, pledge_id=second.id)
        first = await _reload(db_session, first.id)
        second = await _reload(db_session, second.id)
        assert (first.fulfilled_amount, first.status) == (0, PledgeStatus.PENDING)
        assert (second.fulfilled_amount, second.status) == (
            Decimal("200.00"),
            PledgeStatus.FULFILLED,
        )

    async def test_an_unrelated_edit_of_a_gift_on_a_fulfilled_pledge(
        self, db_session, dept
    ):
        pledge = await dept["pledge"]()
        gift = await _give(dept, pledge.id, "500")
        await _edit(dept, gift.id, notes="Thank-you card sent")
        pledge = await _reload(db_session, pledge.id)
        assert pledge.fulfilled_amount == Decimal("500.00")
        assert pledge.status == PledgeStatus.FULFILLED

    async def test_linking_an_existing_gift_counts_it(self, db_session, dept):
        pledge = await dept["pledge"]()
        gift = await _give(dept, None, "120")
        await _edit(dept, gift.id, pledge_id=pledge.id)
        assert (await _reload(db_session, pledge.id)).fulfilled_amount == Decimal(
            "120.00"
        )
