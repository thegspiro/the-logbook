"""
W39-5 follow-on: inspect a return notice that was received another way.

A direct return (unassign, pool return, loan check-in) marks the member's open
notice ``received`` without inspecting it (see
``test_inventory_direct_return_closes_notice.py``). The owner's decision
(2026-10-12): such a notice can then be **inspected** through the review
endpoint with ``status="inspected"``. That records the observed condition, the
officer's notes and the follow-up and completes the notice — and must not move
the gear a second time, because the direct return already did.
"""

import uuid

import pytest
from sqlalchemy import select

from app.models.inventory import (
    InventoryItem,
    ItemAssignment,
    ItemCondition,
    ItemIssuance,
    ItemStatus,
    MaintenanceRecord,
    ReturnRequestStatus,
    TrackingType,
)
from app.models.user import Organization, User
from app.services.inventory_service import InventoryService

pytestmark = pytest.mark.integration


async def _org(db):
    org = Organization(name="Inspect FD", slug=f"inspect-{uuid.uuid4().hex[:8]}")
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
        barcode=f"BC-{uuid.uuid4().hex[:10]}",
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


async def _snapshot(db, item):
    """Everything an inspection must leave alone: the item's stock columns and
    every holding row against it."""
    await db.refresh(item)
    assignments = (
        (
            await db.execute(
                select(ItemAssignment).where(ItemAssignment.item_id == item.id)
            )
        )
        .scalars()
        .all()
    )
    issuances = (
        (await db.execute(select(ItemIssuance).where(ItemIssuance.item_id == item.id)))
        .scalars()
        .all()
    )
    for row in (*assignments, *issuances):
        await db.refresh(row)
    return {
        "quantity": item.quantity,
        "quantity_issued": item.quantity_issued,
        "assigned_to": item.assigned_to_user_id,
        "assignments": sorted((a.id, a.is_active, a.returned_by) for a in assignments),
        "issuances": sorted(
            (i.id, i.quantity_issued, i.is_returned) for i in issuances
        ),
    }


async def _assigned_helmet(db_session):
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
        service, org, member, item, "assignment", assignment_id=_uid(assignment.id)
    )
    return service, org, qm, item, assignment, notice


async def _received_helmet(db_session):
    service, org, qm, item, _assignment, notice = await _assigned_helmet(db_session)
    ok, err = await service.unassign_item(
        _uid(item.id), _uid(org.id), _uid(qm.id), ItemCondition.GOOD
    )
    assert ok, err
    inspector = await _user(db_session, org, "Riley")
    return service, org, inspector, item, notice


class TestInspection:
    async def test_inspection_completes_the_notice_without_moving_stock(
        self, db_session
    ):
        service, org, inspector, item, notice = await _received_helmet(db_session)
        before = await _snapshot(db_session, item)

        ok, err = await service.review_return_request(
            _uid(notice.id),
            _uid(org.id),
            _uid(inspector.id),
            "inspected",
            review_notes="Shell scuffed, liner fine",
            observed_condition="fair",
        )

        assert ok, err
        await db_session.refresh(notice)
        assert notice.status == ReturnRequestStatus.COMPLETED
        assert notice.observed_condition == ItemCondition.FAIR
        assert notice.reviewed_by == inspector.id
        assert notice.follow_up_type is None
        assert notice.received_quantity == 1
        # The receipt's account survives, naming who took the gear back.
        assert "not through this notice" in notice.review_notes
        assert "Received by Sam Avery." in notice.review_notes
        assert "Inspected: fair -- Shell scuffed, liner fine" in notice.review_notes
        assert await _snapshot(db_session, item) == before
        assert item.status == ItemStatus.AVAILABLE

    async def test_an_unsafe_inspection_pulls_shelf_gear_into_maintenance(
        self, db_session
    ):
        service, org, inspector, item, notice = await _received_helmet(db_session)
        before = await _snapshot(db_session, item)

        ok, err = await service.review_return_request(
            _uid(notice.id),
            _uid(org.id),
            _uid(inspector.id),
            "inspected",
            observed_condition="damaged",
        )

        assert ok, err
        await db_session.refresh(notice)
        assert notice.status == ReturnRequestStatus.COMPLETED
        assert notice.follow_up_type == "maintenance"
        record = (
            await db_session.execute(
                select(MaintenanceRecord).where(
                    MaintenanceRecord.id == notice.follow_up_id
                )
            )
        ).scalar_one()
        assert record.item_id == item.id
        assert await _snapshot(db_session, item) == before
        assert item.status == ItemStatus.IN_MAINTENANCE
        assert item.condition == ItemCondition.DAMAGED

    async def test_an_unsafe_inspection_needs_a_follow_up(self, db_session):
        service, org, inspector, _item_row, notice = await _received_helmet(db_session)

        ok, error = await service.review_return_request(
            _uid(notice.id),
            _uid(org.id),
            _uid(inspector.id),
            "inspected",
            observed_condition="poor",
            follow_up="none",
        )

        assert not ok
        assert "requires a follow-up" in error
        await db_session.refresh(notice)
        assert notice.status == ReturnRequestStatus.RECEIVED

    async def test_inspection_requires_an_observed_condition(self, db_session):
        service, org, inspector, _item_row, notice = await _received_helmet(db_session)

        ok, error = await service.review_return_request(
            _uid(notice.id), _uid(org.id), _uid(inspector.id), "inspected"
        )

        assert not ok
        assert error == "Observed condition is required to inspect a return"

    async def test_a_pool_inspection_moves_no_units(self, db_session):
        org = await _org(db_session)
        member = await _user(db_session, org)
        qm = await _user(db_session, org, "Sam")
        item = await _item(db_session, org, TrackingType.POOL, quantity=10)
        service = InventoryService(db_session)
        issuance, err = await service.issue_from_pool(
            _uid(item.id), _uid(member.id), _uid(org.id), _uid(qm.id), 4
        )
        assert err is None, err
        notice = await _notice(
            service,
            org,
            member,
            item,
            "issuance",
            issuance_id=_uid(issuance.id),
            quantity_returning=2,
        )
        ok, err = await service.return_to_pool(
            _uid(issuance.id),
            _uid(org.id),
            _uid(qm.id),
            ItemCondition.GOOD,
            quantity_returned=2,
        )
        assert ok, err
        before = await _snapshot(db_session, item)

        ok, err = await service.review_return_request(
            _uid(notice.id),
            _uid(org.id),
            _uid(qm.id),
            "inspected",
            observed_condition="damaged",
            follow_up="charge_review",
        )

        assert ok, err
        await db_session.refresh(notice)
        await db_session.refresh(issuance)
        assert notice.status == ReturnRequestStatus.COMPLETED
        assert notice.follow_up_type == "charge_review"
        assert issuance.charge_status == "pending"
        assert await _snapshot(db_session, item) == before


class TestRefusals:
    async def test_a_requested_notice_cannot_be_inspected(self, db_session):
        service, org, qm, _item_row, _assignment, notice = await _assigned_helmet(
            db_session
        )

        ok, error = await service.review_return_request(
            _uid(notice.id),
            _uid(org.id),
            _uid(qm.id),
            "inspected",
            observed_condition="good",
        )

        assert not ok
        assert "this one is requested" in error

    async def test_a_completed_notice_cannot_be_inspected_again(self, db_session):
        service, org, inspector, _item_row, notice = await _received_helmet(db_session)
        ok, err = await service.review_return_request(
            _uid(notice.id),
            _uid(org.id),
            _uid(inspector.id),
            "inspected",
            observed_condition="good",
        )
        assert ok, err

        ok, error = await service.review_return_request(
            _uid(notice.id),
            _uid(org.id),
            _uid(inspector.id),
            "inspected",
            observed_condition="good",
        )

        assert not ok
        assert "this one is completed" in error

    async def test_a_denied_notice_cannot_be_inspected(self, db_session):
        service, org, qm, _item_row, _assignment, notice = await _assigned_helmet(
            db_session
        )
        ok, err = await service.review_return_request(
            _uid(notice.id), _uid(org.id), _uid(qm.id), "denied"
        )
        assert ok, err

        ok, error = await service.review_return_request(
            _uid(notice.id),
            _uid(org.id),
            _uid(qm.id),
            "inspected",
            observed_condition="good",
        )

        assert not ok
        assert "this one is denied" in error

    async def test_a_received_notice_still_cannot_be_received_or_denied(
        self, db_session
    ):
        service, org, inspector, _item_row, notice = await _received_helmet(db_session)

        ok, error = await service.review_return_request(
            _uid(notice.id), _uid(org.id), _uid(inspector.id), "denied"
        )

        assert not ok
        assert error == "Request is already received"

    async def test_another_org_cannot_inspect_the_notice(self, db_session):
        service, _org_row, _inspector, _item_row, notice = await _received_helmet(
            db_session
        )
        other = await _org(db_session)
        outsider = await _user(db_session, other, "Morgan")

        ok, error = await service.review_return_request(
            _uid(notice.id),
            _uid(other.id),
            _uid(outsider.id),
            "inspected",
            observed_condition="good",
        )

        assert not ok
        assert error == "Return request not found"
        await db_session.refresh(notice)
        assert notice.status == ReturnRequestStatus.RECEIVED


class TestReceiptUnchanged:
    async def test_a_requested_notice_is_still_received_as_before(self, db_session):
        service, org, qm, item, assignment, notice = await _assigned_helmet(db_session)
        before_quantity = item.quantity

        ok, err = await service.review_return_request(
            _uid(notice.id),
            _uid(org.id),
            _uid(qm.id),
            "received",
            observed_condition="good",
            verified_identifier=item.barcode,
        )

        assert ok, err
        await db_session.refresh(notice)
        await db_session.refresh(assignment)
        await db_session.refresh(item)
        assert notice.status == ReturnRequestStatus.COMPLETED
        assert notice.observed_condition == ItemCondition.GOOD
        assert assignment.is_active is False
        assert item.assigned_to_user_id is None
        assert item.quantity == before_quantity
