"""
``json_array_contains`` finds an element anywhere in a JSON array.

The calls it replaced, ``TrainingRequirement.category_ids.contains([id])``,
compiled to ``LIKE '%["id"]%'`` on a plain JSON column: a match only when the
id was the array's sole element. A requirement filed under two categories was
invisible to both, so hours credited in either category never reached it.
Run against the real database because the bug was in the SQL, not in Python.
"""

import uuid

import pytest
from sqlalchemy import select

from app.models.training import TrainingRequirement
from app.models.user import Organization
from app.utils.json_ids import json_array_contains

pytestmark = pytest.mark.integration


async def _requirement(db, **columns):
    org = Organization(name="JSON Contains FD", slug=f"jc-{uuid.uuid4().hex[:8]}")
    db.add(org)
    await db.flush()
    req = TrainingRequirement(
        organization_id=org.id,
        name="Live Fire",
        requirement_type="hours",
        frequency="annual",
        **columns,
    )
    db.add(req)
    await db.flush()
    return req


async def _matches(db, req, column, value) -> bool:
    found = await db.execute(
        select(TrainingRequirement.id).where(
            TrainingRequirement.id == req.id, json_array_contains(column, value)
        )
    )
    return found.scalar_one_or_none() is not None


@pytest.mark.parametrize("position", [0, 1, 2])
async def test_finds_the_value_at_any_position(db_session, position):
    ids = ["cat-a", "cat-b", "cat-c"]
    req = await _requirement(db_session, category_ids=ids)

    assert await _matches(
        db_session, req, TrainingRequirement.category_ids, ids[position]
    )


async def test_a_value_only_a_substring_of_an_element_does_not_match(db_session):
    req = await _requirement(db_session, category_ids=["cat-abc"])

    assert not await _matches(
        db_session, req, TrainingRequirement.category_ids, "cat-a"
    )


async def test_a_null_array_does_not_match(db_session):
    req = await _requirement(db_session, category_ids=None)

    assert not await _matches(db_session, req, TrainingRequirement.category_ids, "x")


async def test_required_positions_filter(db_session):
    req = await _requirement(
        db_session, required_positions=["probationary", "driver_candidate"]
    )

    assert await _matches(
        db_session, req, TrainingRequirement.required_positions, "driver_candidate"
    )
