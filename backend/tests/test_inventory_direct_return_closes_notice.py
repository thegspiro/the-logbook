"""
W39-5: gear received back through a direct return takes the member's open
return notice off the queue.

A member's "Notify quartermaster of return" opens a notice. When the
quartermaster instead takes the gear through Return on the members page
(unassign), a pool return, or a loan check-in, the notice used to stay
``requested`` — in the queue, on the hub's attention list and in the member's
Pending count — and could then only be denied. The owner's decision: mark it
**received for inspection**. The notice records that the gear came back and by
which path; it does not claim an inspection (``observed_condition`` stays
empty) and is not completed.
"""

import inspect
import uuid

import pytest

from app.models.inventory import (
    InventoryItem,
    ItemCondition,
    ReturnRequestStatus,
    TrackingType,
)
from app.models.user import Organization, User
from app.services.inventory_service import InventoryService

pytestmark = pytest.mark.integration


async def _org(db):
    org = Organization(name="Return FD", slug=f"return-{uuid.uuid4().hex[:8]}")
    db.add(org)
    await db.flush()
    return org


async def _user(db, org, first="Jordan"):
    user = User(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        username=f"m-{uuid.uuid4().hex[:8]}",
        email=f"{uuid.uuid4().hex[:8]}@example.test",
        first_name=first,
        last_name="Avery",
        password_hash="x",
    )
    db.add(user)
    await db.flush()
    return user


async def _item(db, org, tracking=TrackingType.INDIVIDUAL, quantity=1):
    item = InventoryItem(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        name="Helmet" if tracking == TrackingType.INDIVIDUAL else "Nitrile Gloves",
        tracking_type=tracking,
        quantity=quantity,
        active=True,
    )
    db.add(item)
    await db.flush()
    return item


def _uid(value):
    return uuid.UUID(str(value))


async def _notice(service, org, member, item, kind, **holding):
    notice, error = await service.create_return_request(
        organization_id=_uid(org.id),
        requester_id=_uid(member.id),
        return_type=kind,
        item_id=_uid(item.id),
        **holding,
    )
    assert error is None, error
    return notice


class TestUnassign:
    async def test_a_direct_return_marks_the_notice_received(self, db_session):
        org = await _org(db_session)
        member = await _user(db_session, org)
        qm = await _user(db_session, org, "Sam")
        item = await _item(db_session, org)
        service = InventoryService(db_session)
        assignment, err = await service.assign_item_to_user(
            _uid(item.id), _uid(member.id), _uid(org.id), _uid(qm.id)
        )
        assert err is None, err
        notice = await _notice(
            service,
            org,
            member,
            item,
            "assignment",
            assignment_id=_uid(assignment.id),
        )

        ok, err = await service.unassign_item(
            _uid(item.id), _uid(org.id), _uid(qm.id), ItemCondition.GOOD
        )

        assert ok, err
        await db_session.refresh(notice)
        assert notice.status == ReturnRequestStatus.RECEIVED
        assert notice.reviewed_by == qm.id
        assert notice.reviewed_at is not None
        assert notice.received_quantity == 1
        assert "not through this notice" in notice.review_notes
        # Received, not inspected: the notice claims no condition of its own.
        assert notice.observed_condition is None
        assert notice.follow_up_type is None

    async def test_a_received_notice_leaves_the_requested_queue(self, db_session):
        org = await _org(db_session)
        member = await _user(db_session, org)
        qm = await _user(db_session, org, "Sam")
        item = await _item(db_session, org)
        service = InventoryService(db_session)
        assignment, _ = await service.assign_item_to_user(
            _uid(item.id), _uid(member.id), _uid(org.id), _uid(qm.id)
        )
        await _notice(
            service,
            org,
            member,
            item,
            "assignment",
            assignment_id=_uid(assignment.id),
        )

        await service.unassign_item(_uid(item.id), _uid(org.id), _uid(qm.id))

        queue = await service.get_return_requests(_uid(org.id), "requested")
        assert queue == []

    async def test_a_received_notice_cannot_then_be_reviewed(self, db_session):
        org = await _org(db_session)
        member = await _user(db_session, org)
        qm = await _user(db_session, org, "Sam")
        item = await _item(db_session, org)
        service = InventoryService(db_session)
        assignment, _ = await service.assign_item_to_user(
            _uid(item.id), _uid(member.id), _uid(org.id), _uid(qm.id)
        )
        notice = await _notice(
            service,
            org,
            member,
            item,
            "assignment",
            assignment_id=_uid(assignment.id),
        )
        await service.unassign_item(_uid(item.id), _uid(org.id), _uid(qm.id))

        ok, error = await service.review_return_request(
            _uid(notice.id), _uid(org.id), _uid(qm.id), "denied"
        )

        assert not ok
        assert error == "Request is already received"


class TestCheckin:
    async def test_checking_a_loan_in_marks_the_notice_received(self, db_session):
        org = await _org(db_session)
        member = await _user(db_session, org)
        qm = await _user(db_session, org, "Sam")
        item = await _item(db_session, org)
        service = InventoryService(db_session)
        checkout, err = await service.checkout_item(
            _uid(item.id), _uid(member.id), _uid(org.id), _uid(qm.id)
        )
        assert err is None, err
        notice = await _notice(
            service, org, member, item, "checkout", checkout_id=_uid(checkout.id)
        )

        ok, err = await service.checkin_item(
            _uid(checkout.id), _uid(org.id), _uid(qm.id), ItemCondition.GOOD
        )

        assert ok, err
        await db_session.refresh(notice)
        assert notice.status == ReturnRequestStatus.RECEIVED
        assert "check-in" in notice.review_notes


class TestPoolReturn:
    async def _issued(self, db_session, issued=4, announced=2):
        org = await _org(db_session)
        member = await _user(db_session, org)
        qm = await _user(db_session, org, "Sam")
        item = await _item(db_session, org, TrackingType.POOL, quantity=10)
        service = InventoryService(db_session)
        issuance, err = await service.issue_from_pool(
            _uid(item.id), _uid(member.id), _uid(org.id), _uid(qm.id), issued
        )
        assert err is None, err
        notice = await _notice(
            service,
            org,
            member,
            item,
            "issuance",
            issuance_id=_uid(issuance.id),
            quantity_returning=announced,
        )
        return service, org, qm, issuance, notice

    async def test_returning_what_was_announced_marks_it_received(self, db_session):
        service, org, qm, issuance, notice = await self._issued(db_session)

        ok, err = await service.return_to_pool(
            _uid(issuance.id),
            _uid(org.id),
            _uid(qm.id),
            ItemCondition.GOOD,
            quantity_returned=2,
        )

        assert ok, err
        await db_session.refresh(notice)
        assert notice.status == ReturnRequestStatus.RECEIVED
        assert notice.received_quantity == 2

    async def test_returning_fewer_than_announced_leaves_it_open(self, db_session):
        service, org, qm, issuance, notice = await self._issued(db_session)

        ok, err = await service.return_to_pool(
            _uid(issuance.id),
            _uid(org.id),
            _uid(qm.id),
            ItemCondition.GOOD,
            quantity_returned=1,
        )

        assert ok, err
        await db_session.refresh(notice)
        assert notice.status == ReturnRequestStatus.REQUESTED


class TestOnlyTheMatchingNotice:
    async def test_another_members_notice_on_the_same_item_is_untouched(
        self, db_session
    ):
        """A pool item is held by many members; one member's return must not
        close a colleague's notice."""
        org = await _org(db_session)
        first = await _user(db_session, org)
        second = await _user(db_session, org, "Casey")
        qm = await _user(db_session, org, "Sam")
        item = await _item(db_session, org, TrackingType.POOL, quantity=10)
        service = InventoryService(db_session)
        mine, _ = await service.issue_from_pool(
            _uid(item.id), _uid(first.id), _uid(org.id), _uid(qm.id), 1
        )
        theirs, _ = await service.issue_from_pool(
            _uid(item.id), _uid(second.id), _uid(org.id), _uid(qm.id), 1
        )
        their_notice = await _notice(
            service, org, second, item, "issuance", issuance_id=_uid(theirs.id)
        )

        ok, err = await service.return_to_pool(
            _uid(mine.id), _uid(org.id), _uid(qm.id), ItemCondition.GOOD
        )

        assert ok, err
        await db_session.refresh(their_notice)
        assert their_notice.status == ReturnRequestStatus.REQUESTED


class TestLockOrder:
    """review_return_request locks the notice, then the item. The direct paths
    must take them in the same order, or a direct return racing a review of
    the same notice deadlocks."""

    @pytest.mark.parametrize(
        "method", ["unassign_item", "return_to_pool", "checkin_item"]
    )
    def test_the_notice_is_locked_before_the_item(self, method):
        source = inspect.getsource(getattr(InventoryService, method))
        assert "_lock_open_return_notices" in source
        assert source.index("_lock_open_return_notices") < source.index(
            "_get_item_locked"
        )
