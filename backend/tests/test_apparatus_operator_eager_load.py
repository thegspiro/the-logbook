"""
Tests that operator writes return an object the response schema can serialize.

`ApparatusOperatorResponse` projects the `evoc_level` relationship. Neither
create nor update loaded it: both ended on `db.refresh()`, which repopulates
columns but not relationships, so FastAPI's response validation touched
`operator.evoc_level` and SQLAlchemy tried a lazy load on an async session —
MissingGreenlet, surfaced to the caller as a 500.

The row was committed *before* that happened, so the failure was doubly
misleading: the UI reported "Failed to save operator" over an operator that
had in fact been created. Every add or edit that named an EVOC level hit it,
which is why no apparatus in the demo data had a certified driver.

Mocked sessions — no DB — matching test_apparatus_service.py.
"""

import inspect
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.models.apparatus import ApparatusOperator
from app.schemas.apparatus import ApparatusOperatorResponse
from app.services.apparatus_service import ApparatusService


@pytest.fixture
def mock_db():
    db = AsyncMock()
    db.add = MagicMock()
    db.commit = AsyncMock()
    db.refresh = AsyncMock()
    db.execute = AsyncMock()
    return db


@pytest.fixture
def service(mock_db):
    return ApparatusService(mock_db)


def test_response_schema_still_projects_the_relationship():
    """If this ever stops being true the eager load can go — until then it can't."""
    assert "evoc_level" in ApparatusOperatorResponse.model_fields


def test_reload_helper_eager_loads_evoc_level(service):
    source = inspect.getsource(service._reload_operator)
    assert "selectinload" in source
    assert "evoc_level" in source


@pytest.mark.parametrize("method", ["create_operator", "update_operator"])
def test_write_paths_reload_rather_than_refresh(service, method):
    """
    `db.refresh()` is the trap: it looks like it re-reads the object, and for
    columns it does, but it leaves relationships unloaded.
    """
    source = inspect.getsource(getattr(service, method))
    assert "_reload_operator" in source, f"{method} does not reload the operator"
    assert (
        "db.refresh(operator)" not in source
    ), f"{method} still relies on refresh(), which does not load evoc_level"


async def test_reload_returns_the_operator(service, mock_db):
    operator = ApparatusOperator(id="op-1")
    result = MagicMock()
    result.scalar_one = MagicMock(return_value=operator)
    mock_db.execute.return_value = result

    assert await service._reload_operator("op-1") is operator
    assert mock_db.execute.await_count == 1
