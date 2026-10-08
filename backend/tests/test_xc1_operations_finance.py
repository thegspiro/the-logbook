"""XC-1 sweep, operations/finance group: client-supplied FKs must be in-org.

The paths covered here are the ones the sweep found still storing a
client-supplied foreign key without checking which organization it belonged
to. Every other create/update path in the group was already validated.

Each cross-org case is paired with a same-org case on the same field, and an
optional FK also proves that ``None`` still goes through: without the positive
halves a guard that refused everything would pass this file.
"""

import uuid
from datetime import date
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException
from sqlalchemy import func, select

from app.api.v1.endpoints.inventory import (
    create_allowance,
    create_equipment_request,
    create_exposure_record,
)
from app.models.inventory import (
    EquipmentRequest,
    InventoryCategory,
    InventoryItem,
    IssuanceAllowance,
    NFPAExposureRecord,
)
from app.models.user import Organization, Position, User
from app.schemas.inventory import (
    EquipmentRequestCreate,
    IssuanceAllowanceCreate,
    NFPAExposureRecordCreate,
)

pytestmark = [pytest.mark.integration]

# The endpoints write an audit row after the change; that path is not what
# these tests are about, and the hash-chained audit log is exercised elsewhere.
_AUDIT = "app.api.v1.endpoints.inventory.log_audit_event"


async def _org(db, name: str) -> Organization:
    org = Organization(
        id=str(uuid.uuid4()),
        name=name,
        slug=f"{name.lower()}-{uuid.uuid4().hex[:8]}",
    )
    db.add(org)
    await db.flush()
    return org


async def _user(db, org: Organization) -> User:
    suffix = uuid.uuid4().hex[:8]
    user = User(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        username=f"xc1-{suffix}",
        email=f"xc1-{suffix}@example.org",
    )
    db.add(user)
    await db.flush()
    return user


async def _category(db, org: Organization) -> InventoryCategory:
    category = InventoryCategory(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        name=f"Gear {uuid.uuid4().hex[:6]}",
        item_type="equipment",
    )
    db.add(category)
    await db.flush()
    return category


async def _item(db, org: Organization) -> InventoryItem:
    item = InventoryItem(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        name=f"Helmet {uuid.uuid4().hex[:6]}",
        quantity=1,
        quantity_issued=0,
        active=True,
    )
    db.add(item)
    await db.flush()
    return item


async def _position(db, org: Organization) -> Position:
    position = Position(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        name="Firefighter",
        slug=f"firefighter-{uuid.uuid4().hex[:6]}",
        permissions=[],
    )
    db.add(position)
    await db.flush()
    return position


async def _count(db, model, org_id: str) -> int:
    return (
        await db.execute(
            select(func.count())
            .select_from(model)
            .where(model.organization_id == str(org_id))
        )
    ).scalar_one()


# ---------------------------------------------------------------------------
# Inventory: POST /inventory/requests — category_id
# ---------------------------------------------------------------------------


class TestEquipmentRequestCategory:
    async def _submit(self, db, user, category_id):
        with patch(_AUDIT, AsyncMock()):
            return await create_equipment_request(
                request_data=EquipmentRequestCreate(
                    item_name="Gloves",
                    category_id=category_id,
                    requested_duration="ongoing",
                ),
                db=db,
                current_user=user,
            )

    async def test_foreign_category_is_refused(self, db_session):
        mine = await _org(db_session, "Mine")
        theirs = await _org(db_session, "Theirs")
        user = await _user(db_session, mine)
        foreign = await _category(db_session, theirs)

        with pytest.raises(HTTPException) as exc:
            await self._submit(db_session, user, foreign.id)
        assert exc.value.status_code == 400
        assert exc.value.detail == "Invalid category"
        assert await _count(db_session, EquipmentRequest, mine.id) == 0

    async def test_own_category_is_accepted(self, db_session):
        mine = await _org(db_session, "Mine")
        user = await _user(db_session, mine)
        own = await _category(db_session, mine)

        result = await self._submit(db_session, user, own.id)
        row = await db_session.get(EquipmentRequest, result["id"])
        assert row.category_id == own.id

    async def test_no_category_is_accepted(self, db_session):
        mine = await _org(db_session, "Mine")
        user = await _user(db_session, mine)

        result = await self._submit(db_session, user, None)
        row = await db_session.get(EquipmentRequest, result["id"])
        assert row.category_id is None


# ---------------------------------------------------------------------------
# Inventory: POST /inventory/items/{id}/exposures — user_id
# ---------------------------------------------------------------------------


class TestExposureRecordMember:
    async def _record(self, db, user, item, member_id):
        with patch(_AUDIT, AsyncMock()):
            return await create_exposure_record(
                item_id=uuid.UUID(item.id),
                data=NFPAExposureRecordCreate(
                    exposure_type="structure_fire",
                    exposure_date=date(2026, 9, 1),
                    user_id=member_id,
                ),
                db=db,
                current_user=user,
            )

    async def test_foreign_member_is_refused(self, db_session):
        mine = await _org(db_session, "Mine")
        theirs = await _org(db_session, "Theirs")
        user = await _user(db_session, mine)
        item = await _item(db_session, mine)
        outsider = await _user(db_session, theirs)

        with pytest.raises(HTTPException) as exc:
            await self._record(db_session, user, item, outsider.id)
        assert exc.value.status_code == 400
        assert exc.value.detail == "Invalid member"
        assert await _count(db_session, NFPAExposureRecord, mine.id) == 0

    async def test_own_member_is_accepted(self, db_session):
        mine = await _org(db_session, "Mine")
        user = await _user(db_session, mine)
        item = await _item(db_session, mine)
        member = await _user(db_session, mine)

        record = await self._record(db_session, user, item, member.id)
        assert record.user_id == member.id

    async def test_no_member_is_accepted(self, db_session):
        mine = await _org(db_session, "Mine")
        user = await _user(db_session, mine)
        item = await _item(db_session, mine)

        record = await self._record(db_session, user, item, None)
        assert record.user_id is None


# ---------------------------------------------------------------------------
# Inventory: POST /inventory/allowances — category_id, role_id
# ---------------------------------------------------------------------------


class TestIssuanceAllowanceFks:
    async def _create(self, db, user, category_id, role_id=None):
        with patch(_AUDIT, AsyncMock()):
            return await create_allowance(
                data=IssuanceAllowanceCreate(
                    category_id=category_id, role_id=role_id, max_quantity=3
                ),
                db=db,
                current_user=user,
            )

    async def test_foreign_category_is_refused(self, db_session):
        mine = await _org(db_session, "Mine")
        theirs = await _org(db_session, "Theirs")
        user = await _user(db_session, mine)
        foreign = await _category(db_session, theirs)

        with pytest.raises(HTTPException) as exc:
            await self._create(db_session, user, foreign.id)
        assert exc.value.status_code == 400
        assert exc.value.detail == "Invalid category"
        assert await _count(db_session, IssuanceAllowance, mine.id) == 0

    async def test_foreign_position_is_refused(self, db_session):
        mine = await _org(db_session, "Mine")
        theirs = await _org(db_session, "Theirs")
        user = await _user(db_session, mine)
        own = await _category(db_session, mine)
        foreign = await _position(db_session, theirs)

        with pytest.raises(HTTPException) as exc:
            await self._create(db_session, user, own.id, foreign.id)
        assert exc.value.status_code == 400
        assert exc.value.detail == "Invalid position"
        assert await _count(db_session, IssuanceAllowance, mine.id) == 0

    async def test_own_category_and_position_are_accepted(self, db_session):
        mine = await _org(db_session, "Mine")
        user = await _user(db_session, mine)
        own = await _category(db_session, mine)
        position = await _position(db_session, mine)

        allowance = await self._create(db_session, user, own.id, position.id)
        assert str(allowance.category_id) == own.id
        assert str(allowance.role_id) == position.id

    async def test_no_position_is_accepted(self, db_session):
        mine = await _org(db_session, "Mine")
        user = await _user(db_session, mine)
        own = await _category(db_session, mine)

        allowance = await self._create(db_session, user, own.id)
        assert allowance.role_id is None
