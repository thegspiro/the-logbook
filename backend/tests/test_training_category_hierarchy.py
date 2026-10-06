"""
TrainingCategory's self-referential relationship points the right way.

``remote_side`` was declared on the ``subcategories`` collection, which makes
SQLAlchemy read it as the many-to-one side: ``subcategories`` held the parent
and ``parent_category`` held the children. The same inverted shape left
descendants behind on delete for ``DocumentFolder.children`` and
``CheckTemplateCompartment.children`` (FAC-16). Nothing reads either attribute
yet, and categories are only ever soft-deleted, so this pins the direction
before the first reader relies on the names.
"""

import uuid

import pytest
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.models.training import TrainingCategory
from app.models.user import Organization

pytestmark = pytest.mark.integration


async def _tree(db):
    org = Organization(name="Category Tree FD", slug=f"ct-{uuid.uuid4().hex[:8]}")
    db.add(org)
    await db.flush()
    parent = TrainingCategory(organization_id=org.id, name="Fire")
    db.add(parent)
    await db.flush()
    child = TrainingCategory(
        organization_id=org.id, name="Ventilation", parent_category_id=parent.id
    )
    db.add(child)
    await db.flush()
    grandchild = TrainingCategory(
        organization_id=org.id, name="Vertical", parent_category_id=child.id
    )
    db.add(grandchild)
    await db.flush()
    ids = (parent.id, child.id, grandchild.id)
    db.expunge_all()
    return ids


async def _load(db, category_id):
    return (
        await db.execute(
            select(TrainingCategory)
            .options(
                selectinload(TrainingCategory.parent_category),
                selectinload(TrainingCategory.subcategories),
            )
            .where(TrainingCategory.id == category_id)
        )
    ).scalar_one()


async def test_subcategories_are_the_children_and_parent_is_the_parent(db_session):
    parent_id, child_id, grandchild_id = await _tree(db_session)

    child = await _load(db_session, child_id)

    assert child.parent_category is not None
    assert child.parent_category.id == parent_id
    assert [c.id for c in child.subcategories] == [grandchild_id]


async def test_deleting_a_parent_keeps_its_descendants(db_session):
    parent_id, child_id, grandchild_id = await _tree(db_session)

    await db_session.delete(await _load(db_session, parent_id))
    await db_session.flush()
    db_session.expunge_all()

    child = await _load(db_session, child_id)
    grandchild = await _load(db_session, grandchild_id)
    assert child.parent_category_id is None
    assert grandchild.parent_category_id == child_id
