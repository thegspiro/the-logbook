"""
Tests for the `assigned_to` filter on the item list.

`InventoryItem.assigned_to_user_id` is a `String(36)`, and the endpoint hands
the service a `UUID`. Comparing the two bound a UUID against a char column and
matched nothing, so "everything issued to this member" answered "nothing" for
every member — silently, with a 200 and an empty list. Every other id filter in
the same query already casts with `str()`; this one did not.

Mocked session; no MySQL. The assertion is on the parameters the statement
carries, which is where the defect lived.
"""

from unittest.mock import AsyncMock, MagicMock
from uuid import UUID, uuid4

import pytest

from app.services.inventory_service import InventoryService

ORG_ID = UUID("11111111-1111-1111-1111-111111111111")


@pytest.fixture
def captured_statements():
    return []


@pytest.fixture
def service(captured_statements):
    db = MagicMock()

    async def execute(statement, *args, **kwargs):
        captured_statements.append(statement)
        result = MagicMock()
        result.scalar.return_value = 0
        result.scalars.return_value.all.return_value = []
        return result

    db.execute = AsyncMock(side_effect=execute)
    return InventoryService(db)


def _string_params(statement):
    """Every bound value on a compiled statement, as strings."""
    compiled = statement.compile()
    return {key: value for key, value in compiled.params.items()}


async def test_assigned_to_is_bound_as_a_string(service, captured_statements):
    user_id = uuid4()

    await service.get_items(organization_id=ORG_ID, assigned_to=user_id)

    bound = [v for s in captured_statements for v in _string_params(s).values()]
    assert str(user_id) in bound, "the member id never reached the query as a string"
    # A raw UUID here is the bug: MySQL compares it against a char column and
    # matches nothing rather than erroring.
    assert user_id not in bound


async def test_assigned_to_omitted_adds_no_filter(service, captured_statements):
    await service.get_items(organization_id=ORG_ID)

    bound = [v for s in captured_statements for v in _string_params(s).values()]
    assert str(ORG_ID) in bound
    assert not any(isinstance(v, UUID) for v in bound)


@pytest.mark.parametrize(
    "kwarg", ["category_id", "location_id", "storage_area_id", "assigned_to"]
)
async def test_every_id_filter_binds_a_string(service, captured_statements, kwarg):
    """The rule the `assigned_to` bug broke, applied to all four id filters."""
    value = uuid4()

    await service.get_items(organization_id=ORG_ID, **{kwarg: value})

    bound = [v for s in captured_statements for v in _string_params(s).values()]
    assert str(value) in bound
    assert value not in bound
