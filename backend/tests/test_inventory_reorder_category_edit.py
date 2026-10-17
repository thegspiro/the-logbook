"""
Editing a reorder request's category must persist, and stay org-scoped.

The edit form sent ``category_id`` only on create; ``ReorderRequestUpdate``
did not declare it, so Pydantic dropped the key and a changed category was
acknowledged with a 200 and never written. These tests go through the schema
the endpoint uses (``model_dump(exclude_unset=True)``), so a schema that drops
the field fails them.
"""

import uuid

import pytest

from app.models.inventory import InventoryCategory, ReorderRequest, ReorderStatus
from app.models.user import Organization, User
from app.schemas.inventory import ReorderRequestUpdate
from app.services.inventory_service import InventoryService

pytestmark = pytest.mark.integration


async def _org(db):
    org = Organization(name="Category FD", slug=f"cat-{uuid.uuid4().hex[:8]}")
    db.add(org)
    await db.flush()
    return org


async def _user(db, org):
    user = User(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        username=f"qm-{uuid.uuid4().hex[:8]}",
        email=f"{uuid.uuid4().hex[:8]}@example.test",
        first_name="Pat",
        last_name="Quinn",
        password_hash="x",
    )
    db.add(user)
    await db.flush()
    return user


async def _category(db, org, name="Gloves"):
    category = InventoryCategory(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        name=name,
        item_type="ppe",
        active=True,
    )
    db.add(category)
    await db.flush()
    return category


async def _reorder(db, org, category=None):
    reorder = ReorderRequest(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        category_id=category.id if category else None,
        item_name="Gloves",
        quantity_requested=10,
        quantity_received=0,
        version=1,
        status=ReorderStatus.PENDING,
    )
    db.add(reorder)
    await db.flush()
    return reorder


def _patch(**fields):
    # What the endpoint hands the service.
    return ReorderRequestUpdate(**fields).model_dump(exclude_unset=True)


class TestReorderCategoryEdit:
    async def test_a_changed_category_is_written(self, db_session):
        org = await _org(db_session)
        qm = await _user(db_session, org)
        first = await _category(db_session, org, "Gloves")
        second = await _category(db_session, org, "Hoods")
        reorder = await _reorder(db_session, org, first)

        updated, error = await InventoryService(db_session).update_reorder_request(
            reorder.id, org.id, _patch(category_id=uuid.UUID(second.id)), qm.id
        )

        assert error is None
        await db_session.refresh(reorder)
        assert str(reorder.category_id) == second.id
        assert str(updated.category_id) == second.id

    async def test_an_explicit_null_clears_the_category(self, db_session):
        org = await _org(db_session)
        qm = await _user(db_session, org)
        category = await _category(db_session, org)
        reorder = await _reorder(db_session, org, category)

        _, error = await InventoryService(db_session).update_reorder_request(
            reorder.id, org.id, _patch(category_id=None), qm.id
        )

        assert error is None
        await db_session.refresh(reorder)
        assert reorder.category_id is None

    async def test_a_category_from_another_department_is_refused(self, db_session):
        org = await _org(db_session)
        other = await _org(db_session)
        qm = await _user(db_session, org)
        ours = await _category(db_session, org)
        theirs = await _category(db_session, other)
        reorder = await _reorder(db_session, org, ours)

        updated, error = await InventoryService(db_session).update_reorder_request(
            reorder.id, org.id, _patch(category_id=uuid.UUID(theirs.id)), qm.id
        )

        assert updated is None
        assert error is not None
        await db_session.refresh(reorder)
        assert reorder.category_id == ours.id
