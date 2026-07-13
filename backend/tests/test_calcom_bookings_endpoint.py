"""Tests for the authenticated Cal.com bookings endpoint.

Exercises the endpoint handler directly (bypassing FastAPI DI) with a mocked
DB session and a patched CalcomService. No MySQL.
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException

from app.api.v1.endpoints.calcom_sync import list_calcom_bookings


def _db_returning(integration):
    db = MagicMock()
    result = MagicMock()
    result.scalar_one_or_none.return_value = integration
    db.execute = AsyncMock(return_value=result)
    return db


def _user():
    return SimpleNamespace(organization_id="org-1")


def _integration(api_key="cal_x", config=None):
    integ = SimpleNamespace(config=config or {})
    integ.get_secret = MagicMock(return_value=api_key)
    return integ


async def test_returns_mapped_bookings():
    db = _db_returning(_integration())
    fake_service = MagicMock()
    fake_service.list_bookings = AsyncMock(
        return_value=[{"external_id": "b1", "title": "Interview"}]
    )
    with patch(
        "app.api.v1.endpoints.calcom_sync.CalcomService",
        return_value=fake_service,
    ):
        result = await list_calcom_bookings(db=db, current_user=_user())

    assert result == {"bookings": [{"external_id": "b1", "title": "Interview"}]}


async def test_404_when_not_connected():
    db = _db_returning(None)
    with pytest.raises(HTTPException) as exc:
        await list_calcom_bookings(db=db, current_user=_user())
    assert exc.value.status_code == 404


async def test_400_when_no_api_key():
    db = _db_returning(_integration(api_key=None))
    with pytest.raises(HTTPException) as exc:
        await list_calcom_bookings(db=db, current_user=_user())
    assert exc.value.status_code == 400


async def test_502_when_calcom_call_fails():
    db = _db_returning(_integration())
    fake_service = MagicMock()
    fake_service.list_bookings = AsyncMock(side_effect=Exception("upstream down"))
    with patch(
        "app.api.v1.endpoints.calcom_sync.CalcomService",
        return_value=fake_service,
    ):
        with pytest.raises(HTTPException) as exc:
            await list_calcom_bookings(db=db, current_user=_user())
    assert exc.value.status_code == 502
