"""
Previewing the property-return report before a drop (owner decision 2026-11-01).

The member's profile offers officers who can drop a member a read-only look at
what the drop would ask them to return. The preview is only worth having if it
lists exactly what the drop's letter lists (CLAUDE.md pitfall #29), and only
safe if opening it changes nothing: no document filed, no clearance opened, no
status or service history touched.
"""

import uuid
from datetime import date, datetime, timezone
from decimal import Decimal
from unittest.mock import AsyncMock

import pytest
from fastapi import BackgroundTasks, HTTPException
from sqlalchemy import func, select

from app.api.dependencies import PermissionChecker
from app.api.v1.endpoints import member_status as member_status_endpoint
from app.models.document import Document
from app.models.inventory import (
    CheckOutRecord,
    DepartureClearance,
    InventoryItem,
    ItemAssignment,
    ItemIssuance,
)
from app.models.user import MemberServicePeriod, Organization, User, UserStatus


def _route(path_suffix: str, method: str):
    return next(
        r
        for r in member_status_endpoint.router.routes
        if r.path.endswith(path_suffix) and method in r.methods
    )


def _permissions(route) -> set[str]:
    checkers = [
        d.call
        for d in route.dependant.dependencies
        if isinstance(d.call, PermissionChecker)
    ]
    assert len(checkers) == 1, route.path
    return set(checkers[0].required_permissions)


@pytest.mark.unit
class TestPreviewGate:
    def test_the_preview_takes_the_same_grant_as_the_drop(self):
        preview = _route("/property-return-report", "GET")
        drop = _route("/status", "PATCH")
        assert _permissions(preview) == _permissions(drop) == {"members.manage"}


@pytest.fixture
def _quiet(monkeypatch):
    """Guards with tests of their own, and audit writes, stay out of the way."""
    monkeypatch.setattr(member_status_endpoint, "log_audit_event", AsyncMock())
    monkeypatch.setattr(
        member_status_endpoint, "assert_not_last_administrator", AsyncMock()
    )
    monkeypatch.setattr(
        member_status_endpoint, "_enforce_account_reset_ceiling", AsyncMock()
    )


async def _org(db) -> Organization:
    org = Organization(
        id=str(uuid.uuid4()),
        name="Preview Department",
        slug=f"preview-{uuid.uuid4().hex[:8]}",
        timezone="UTC",
    )
    db.add(org)
    await db.flush()
    return org


async def _user(db, org, **overrides) -> User:
    handle = uuid.uuid4().hex[:10]
    fields = dict(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        username=f"u-{handle}",
        email=f"{handle}@preview.test",
        first_name="Pat",
        last_name="Lee",
        password_hash="x",
        status=UserStatus.ACTIVE,
        hire_date=date(2019, 5, 1),
    )
    fields.update(overrides)
    user = User(**fields)
    db.add(user)
    await db.flush()
    return user


async def _item(db, org, name, **fields) -> InventoryItem:
    item = InventoryItem(
        id=str(uuid.uuid4()), organization_id=org.id, name=name, **fields
    )
    db.add(item)
    await db.flush()
    return item


async def _equipped_member(db, org) -> User:
    """A member holding one of each kind of accountable property."""
    member = await _user(db, org)
    helmet = await _item(
        db, org, "Helmet", serial_number="SN-1", current_value=Decimal("350.00")
    )
    radio = await _item(
        db, org, "Radio", asset_tag="AT-9", purchase_price=Decimal("120.50")
    )
    gloves = await _item(db, org, "Gloves", current_value=Decimal("15.00"))
    now = datetime.now(timezone.utc)
    db.add_all(
        [
            ItemAssignment(
                organization_id=org.id,
                item_id=helmet.id,
                user_id=member.id,
                is_active=True,
                assigned_date=now,
            ),
            CheckOutRecord(
                organization_id=org.id,
                item_id=radio.id,
                user_id=member.id,
                is_returned=False,
                checked_out_at=now,
            ),
            ItemIssuance(
                organization_id=org.id,
                item_id=gloves.id,
                user_id=member.id,
                quantity_issued=3,
                is_returned=False,
                issued_at=now,
            ),
            # Returned property is not owed and must appear in neither.
            ItemAssignment(
                organization_id=org.id,
                item_id=(await _item(db, org, "Old Coat")).id,
                user_id=member.id,
                is_active=False,
            ),
        ]
    )
    await db.flush()
    return member


async def _count(db, model, **where) -> int:
    query = select(func.count()).select_from(model)
    for column, value in where.items():
        query = query.where(getattr(model, column) == value)
    return int((await db.execute(query)).scalar_one())


@pytest.mark.integration
@pytest.mark.usefixtures("_quiet")
class TestPropertyReturnPreview:
    async def test_lists_each_item_with_identifier_quantity_and_value(self, db_session):
        org = await _org(db_session)
        officer = await _user(db_session, org)
        member = await _equipped_member(db_session, org)

        preview = await member_status_endpoint.get_property_return_preview(
            user_id=uuid.UUID(member.id), db=db_session, current_user=officer
        )

        rows = {i.type: i for i in preview.items}
        assert set(rows) == {"assigned", "checked_out", "issued"}
        assert rows["assigned"].serial_number == "SN-1"
        assert rows["assigned"].quantity == 1
        assert rows["assigned"].value == 350.0
        assert rows["checked_out"].asset_tag == "AT-9"
        assert rows["checked_out"].value == 120.5
        assert rows["issued"].quantity == 3
        assert rows["issued"].value == 45.0
        assert preview.item_count == 3
        assert preview.total_value == 515.5

    async def test_lists_exactly_what_the_drop_report_lists(self, db_session):
        org = await _org(db_session)
        officer = await _user(db_session, org)
        member = await _equipped_member(db_session, org)

        preview = await member_status_endpoint.get_property_return_preview(
            user_id=uuid.UUID(member.id), db=db_session, current_user=officer
        )
        dropped = await member_status_endpoint.change_member_status(
            user_id=uuid.UUID(member.id),
            request=member_status_endpoint.MemberStatusChangeRequest(
                new_status="dropped_voluntary", send_property_return_email=False
            ),
            background_tasks=BackgroundTasks(),
            db=db_session,
            current_user=officer,
        )

        report = dropped.property_return_report
        assert report is not None
        assert report["item_count"] == preview.item_count
        assert float(report["total_value"]) == preview.total_value
        letter = (
            await db_session.execute(
                select(Document.content_html).where(Document.id == dropped.document_id)
            )
        ).scalar_one()
        for item in preview.items:
            assert item.name in letter
        assert "Old Coat" not in letter
        assert all(i.name != "Old Coat" for i in preview.items)

    async def test_previewing_changes_nothing(self, db_session):
        org = await _org(db_session)
        officer = await _user(db_session, org)
        member = await _equipped_member(db_session, org)

        await member_status_endpoint.get_property_return_preview(
            user_id=uuid.UUID(member.id), db=db_session, current_user=officer
        )

        await db_session.refresh(member)
        assert member.status == UserStatus.ACTIVE
        assert member.status_changed_at is None
        assert await _count(db_session, Document, organization_id=org.id) == 0
        assert await _count(db_session, DepartureClearance, user_id=member.id) == 0
        assert await _count(db_session, MemberServicePeriod, user_id=member.id) == 0

    async def test_a_member_with_nothing_owed_previews_empty(self, db_session):
        org = await _org(db_session)
        officer = await _user(db_session, org)
        member = await _user(db_session, org)

        preview = await member_status_endpoint.get_property_return_preview(
            user_id=uuid.UUID(member.id), db=db_session, current_user=officer
        )

        assert preview.items == []
        assert preview.item_count == 0
        assert preview.total_value == 0

    async def test_another_departments_member_is_not_found(self, db_session):
        org = await _org(db_session)
        other = await _org(db_session)
        outsider = await _user(db_session, other)
        member = await _equipped_member(db_session, org)

        with pytest.raises(HTTPException) as exc:
            await member_status_endpoint.get_property_return_preview(
                user_id=uuid.UUID(member.id), db=db_session, current_user=outsider
            )

        assert exc.value.status_code == 404
