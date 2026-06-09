"""
Integration tests for inventory functionality-gap fixes:

  - Issuance allowance enforcement (issue_from_pool respects per-category caps)
  - Retirement notifications queued when an assigned item is written off
  - Equipment request fulfillment (approved request -> real issuance/checkout)

These exercise the service layer against the database, so they require the
integration test database (same as the rest of test_inventory*.py).
"""

import uuid
from datetime import date

import pytest
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.inventory import (
    EquipmentRequest,
    InventoryActionType,
    InventoryNotificationQueue,
    IssuanceAllowance,
    ItemAssignment,
    ItemIssuance,
    NFPAInspectionDetail,
    RequestStatus,
    RequestType,
)
from app.services.inventory_service import InventoryService

pytestmark = [pytest.mark.integration]


def _uid() -> str:
    return str(uuid.uuid4())


@pytest.fixture
async def setup_org_and_user(db_session: AsyncSession):
    """Create a minimal organization and two users for inventory tests."""
    org_id = _uid()
    user_id = _uid()
    user2_id = _uid()

    await db_session.execute(
        text(
            "INSERT INTO organizations (id, name, organization_type, slug, timezone) "
            "VALUES (:id, :name, :otype, :slug, :tz)"
        ),
        {
            "id": org_id,
            "name": "Test Dept",
            "otype": "fire_department",
            "slug": f"test-{org_id[:8]}",
            "tz": "UTC",
        },
    )
    for uid, uname, fn, ln in [
        (user_id, "jsmith", "John", "Smith"),
        (user2_id, "jdoe", "Jane", "Doe"),
    ]:
        await db_session.execute(
            text(
                "INSERT INTO users (id, organization_id, username, first_name, "
                "last_name, email, password_hash, status) "
                "VALUES (:id, :org, :un, :fn, :ln, :em, :pw, 'active')"
            ),
            {
                "id": uid,
                "org": org_id,
                "un": uname,
                "fn": fn,
                "ln": ln,
                "em": f"{uname}@test.com",
                "pw": "hashed",
            },
        )
    await db_session.flush()
    return org_id, user_id, user2_id


async def _make_pool_item(svc, org_id, user_id, quantity=10):
    cat, _ = await svc.create_category(
        organization_id=uuid.UUID(org_id),
        category_data={"name": "Polos", "item_type": "uniform"},
    )
    item, err = await svc.create_item(
        organization_id=uuid.UUID(org_id),
        item_data={
            "name": "Polo Shirt",
            "condition": "good",
            "status": "available",
            "tracking_type": "pool",
            "quantity": quantity,
            "category_id": cat.id,
        },
        created_by=uuid.UUID(user_id),
    )
    assert err is None
    return cat, item


# ── Issuance Allowance Enforcement ─────────────────────────────────

class TestIssuanceAllowanceEnforcement:

    @pytest.mark.asyncio
    async def test_no_allowance_means_unlimited(self, db_session, setup_org_and_user):
        org_id, user_id, member_id = await setup_org_and_user
        svc = InventoryService(db_session)
        _, item = await _make_pool_item(svc, org_id, user_id)

        issuance, err = await svc.issue_from_pool(
            item_id=uuid.UUID(item.id),
            user_id=uuid.UUID(member_id),
            organization_id=uuid.UUID(org_id),
            issued_by=uuid.UUID(user_id),
            quantity=7,
        )
        assert err is None
        assert issuance is not None

    @pytest.mark.asyncio
    async def test_issue_blocked_when_over_allowance(self, db_session, setup_org_and_user):
        org_id, user_id, member_id = await setup_org_and_user
        svc = InventoryService(db_session)
        cat, item = await _make_pool_item(svc, org_id, user_id)

        db_session.add(
            IssuanceAllowance(
                organization_id=org_id,
                category_id=cat.id,
                role_id=None,
                max_quantity=3,
                period_type="annual",
                is_active=True,
            )
        )
        await db_session.flush()

        # First issue of 2 is within the cap of 3.
        _, err = await svc.issue_from_pool(
            item_id=uuid.UUID(item.id),
            user_id=uuid.UUID(member_id),
            organization_id=uuid.UUID(org_id),
            issued_by=uuid.UUID(user_id),
            quantity=2,
        )
        assert err is None

        # Second issue of 2 would total 4 > 3 — must be blocked.
        issuance, err = await svc.issue_from_pool(
            item_id=uuid.UUID(item.id),
            user_id=uuid.UUID(member_id),
            organization_id=uuid.UUID(org_id),
            issued_by=uuid.UUID(user_id),
            quantity=2,
        )
        assert issuance is None
        assert err is not None
        assert "allowance" in err.lower()

    @pytest.mark.asyncio
    async def test_override_bypasses_allowance(self, db_session, setup_org_and_user):
        org_id, user_id, member_id = await setup_org_and_user
        svc = InventoryService(db_session)
        cat, item = await _make_pool_item(svc, org_id, user_id)

        db_session.add(
            IssuanceAllowance(
                organization_id=org_id,
                category_id=cat.id,
                role_id=None,
                max_quantity=1,
                period_type="annual",
                is_active=True,
            )
        )
        await db_session.flush()

        issuance, err = await svc.issue_from_pool(
            item_id=uuid.UUID(item.id),
            user_id=uuid.UUID(member_id),
            organization_id=uuid.UUID(org_id),
            issued_by=uuid.UUID(user_id),
            quantity=5,
            override_allowance=True,
        )
        assert err is None
        assert issuance is not None


# ── Retirement Notification on Write-Off ───────────────────────────

class TestRetirementNotificationQueued:

    @pytest.mark.asyncio
    async def test_writeoff_approval_queues_retirement_notice(
        self, db_session, setup_org_and_user
    ):
        org_id, user_id, member_id = await setup_org_and_user
        svc = InventoryService(db_session)

        item, _ = await svc.create_item(
            organization_id=uuid.UUID(org_id),
            item_data={"name": "Helmet", "condition": "good", "status": "available"},
            created_by=uuid.UUID(user_id),
        )
        await svc.assign_item_to_user(
            item_id=uuid.UUID(item.id),
            user_id=uuid.UUID(member_id),
            organization_id=uuid.UUID(org_id),
            assigned_by=uuid.UUID(user_id),
        )

        wo, err = await svc.create_write_off_request(
            item_id=item.id,
            organization_id=org_id,
            requested_by=user_id,
            reason="lost",
            description="Lost at a fire scene",
        )
        assert err is None

        _, err = await svc.review_write_off(
            write_off_id=wo["id"],
            organization_id=org_id,
            reviewed_by=user_id,
            decision="approved",
        )
        assert err is None

        result = await db_session.execute(
            select(InventoryNotificationQueue).where(
                InventoryNotificationQueue.organization_id == org_id,
                InventoryNotificationQueue.user_id == member_id,
                InventoryNotificationQueue.action_type == InventoryActionType.RETIRED,
            )
        )
        notices = result.scalars().all()
        assert len(notices) == 1
        assert notices[0].item_id == item.id


# ── Equipment Request Fulfillment ──────────────────────────────────

class TestEquipmentRequestFulfillment:

    @pytest.mark.asyncio
    async def test_fulfill_pool_request_creates_issuance(
        self, db_session, setup_org_and_user
    ):
        org_id, user_id, member_id = await setup_org_and_user
        svc = InventoryService(db_session)
        _, item = await _make_pool_item(svc, org_id, user_id)

        req = EquipmentRequest(
            organization_id=org_id,
            requester_id=member_id,
            item_name="Polo Shirt",
            item_id=item.id,
            quantity=2,
            request_type=RequestType.ISSUANCE,
            status=RequestStatus.APPROVED,
        )
        db_session.add(req)
        await db_session.flush()

        fulfilled, err = await svc.fulfill_equipment_request(
            request_id=uuid.UUID(req.id),
            organization_id=uuid.UUID(org_id),
            fulfilled_by=uuid.UUID(user_id),
        )
        assert err is None
        assert fulfilled.status == RequestStatus.FULFILLED
        assert fulfilled.fulfillment_type == "issuance"
        assert fulfilled.fulfillment_reference_id is not None

        result = await db_session.execute(
            select(ItemIssuance).where(
                ItemIssuance.id == fulfilled.fulfillment_reference_id
            )
        )
        issuance = result.scalar_one_or_none()
        assert issuance is not None
        assert issuance.user_id == member_id
        assert issuance.quantity_issued == 2

    @pytest.mark.asyncio
    async def test_fulfill_requires_approved_status(
        self, db_session, setup_org_and_user
    ):
        org_id, user_id, member_id = await setup_org_and_user
        svc = InventoryService(db_session)
        _, item = await _make_pool_item(svc, org_id, user_id)

        req = EquipmentRequest(
            organization_id=org_id,
            requester_id=member_id,
            item_name="Polo Shirt",
            item_id=item.id,
            quantity=1,
            request_type=RequestType.ISSUANCE,
            status=RequestStatus.PENDING,
        )
        db_session.add(req)
        await db_session.flush()

        fulfilled, err = await svc.fulfill_equipment_request(
            request_id=uuid.UUID(req.id),
            organization_id=uuid.UUID(org_id),
            fulfilled_by=uuid.UUID(user_id),
        )
        assert fulfilled is None
        assert err is not None
        assert "approved" in err.lower()


# ── Write-Off Releases Holder Records ──────────────────────────────

class TestWriteOffReleasesHolders:

    @pytest.mark.asyncio
    async def test_individual_item_is_unassigned_on_writeoff(
        self, db_session, setup_org_and_user
    ):
        org_id, user_id, member_id = await setup_org_and_user
        svc = InventoryService(db_session)

        item, _ = await svc.create_item(
            organization_id=uuid.UUID(org_id),
            item_data={"name": "Helmet", "condition": "good", "status": "available"},
            created_by=uuid.UUID(user_id),
        )
        await svc.assign_item_to_user(
            item_id=uuid.UUID(item.id),
            user_id=uuid.UUID(member_id),
            organization_id=uuid.UUID(org_id),
            assigned_by=uuid.UUID(user_id),
        )

        wo, err = await svc.create_write_off_request(
            item_id=item.id,
            organization_id=org_id,
            requested_by=user_id,
            reason="lost",
            description="Lost it",
        )
        assert err is None
        await svc.review_write_off(
            write_off_id=wo["id"],
            organization_id=org_id,
            reviewed_by=user_id,
            decision="approved",
        )

        refreshed = await svc.get_item_by_id(uuid.UUID(item.id), uuid.UUID(org_id))
        assert refreshed.assigned_to_user_id is None

        result = await db_session.execute(
            select(ItemAssignment).where(ItemAssignment.item_id == item.id)
        )
        assert all(not a.is_active for a in result.scalars().all())

    @pytest.mark.asyncio
    async def test_pool_issuances_closed_on_writeoff(
        self, db_session, setup_org_and_user
    ):
        org_id, user_id, member_id = await setup_org_and_user
        svc = InventoryService(db_session)
        _, item = await _make_pool_item(svc, org_id, user_id)

        await svc.issue_from_pool(
            item_id=uuid.UUID(item.id),
            user_id=uuid.UUID(member_id),
            organization_id=uuid.UUID(org_id),
            issued_by=uuid.UUID(user_id),
            quantity=3,
        )

        wo, err = await svc.create_write_off_request(
            item_id=item.id,
            organization_id=org_id,
            requested_by=user_id,
            reason="damaged_beyond_repair",
            description="Crushed",
        )
        assert err is None
        await svc.review_write_off(
            write_off_id=wo["id"],
            organization_id=org_id,
            reviewed_by=user_id,
            decision="approved",
        )

        refreshed = await svc.get_item_by_id(uuid.UUID(item.id), uuid.UUID(org_id))
        assert refreshed.quantity_issued == 0

        result = await db_session.execute(
            select(ItemIssuance).where(ItemIssuance.item_id == item.id)
        )
        assert all(i.is_returned for i in result.scalars().all())


# ── NFPA Inspection Write Path ─────────────────────────────────────

class TestNFPAInspectionWritePath:

    @pytest.mark.asyncio
    async def test_maintenance_create_persists_nfpa_inspection(
        self, db_session, setup_org_and_user
    ):
        org_id, user_id, _ = await setup_org_and_user
        svc = InventoryService(db_session)

        item, _ = await svc.create_item(
            organization_id=uuid.UUID(org_id),
            item_data={"name": "Turnout Coat", "condition": "good", "status": "available"},
            created_by=uuid.UUID(user_id),
        )

        record, err = await svc.create_maintenance_record(
            item_id=uuid.UUID(item.id),
            organization_id=uuid.UUID(org_id),
            created_by=uuid.UUID(user_id),
            maintenance_data={
                "maintenance_type": "inspection",
                "is_completed": True,
                "completed_date": date(2026, 1, 1),
                "nfpa_inspection": {
                    "inspection_level": "advanced",
                    "thermal_damage": True,
                    "seam_integrity": False,
                    "recommendation": "repair",
                },
            },
        )
        assert err is None

        result = await db_session.execute(
            select(NFPAInspectionDetail).where(
                NFPAInspectionDetail.maintenance_record_id == record.id
            )
        )
        detail = result.scalar_one_or_none()
        assert detail is not None
        assert detail.seam_integrity is False
        assert detail.recommendation is not None


# ── Category Soft-Delete ───────────────────────────────────────────

class TestCategoryDelete:

    @pytest.mark.asyncio
    async def test_delete_blocked_with_active_items(
        self, db_session, setup_org_and_user
    ):
        org_id, user_id, _ = await setup_org_and_user
        svc = InventoryService(db_session)
        cat, item = await _make_pool_item(svc, org_id, user_id)

        ok, err = await svc.delete_category(uuid.UUID(cat.id), uuid.UUID(org_id))
        assert ok is False
        assert err is not None and "active items" in err

    @pytest.mark.asyncio
    async def test_delete_succeeds_without_active_items(
        self, db_session, setup_org_and_user
    ):
        org_id, user_id, _ = await setup_org_and_user
        svc = InventoryService(db_session)
        cat, _ = await svc.create_category(
            organization_id=uuid.UUID(org_id),
            category_data={"name": "Empty Cat", "item_type": "equipment"},
            created_by=uuid.UUID(user_id),
        )

        ok, err = await svc.delete_category(uuid.UUID(cat.id), uuid.UUID(org_id))
        assert ok is True
        assert err is None
        refreshed = await svc.get_category_by_id(uuid.UUID(cat.id), uuid.UUID(org_id))
        assert refreshed.active is False
