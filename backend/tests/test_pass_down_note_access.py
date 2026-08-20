"""Regression tests for the crew handoff confidentiality boundary."""

from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest
from fastapi import HTTPException

from app.api.v1.endpoints.scheduling import _authorize_handoff_access
from app.schemas.scheduling import ShiftResponse


def _user(*, permissions=()):
    return SimpleNamespace(
        id=uuid4(),
        organization_id=uuid4(),
        positions=[SimpleNamespace(permissions=list(permissions))],
        rank=None,
    )


def test_generic_shift_response_does_not_project_pass_down_notes():
    assert "pass_down_notes" not in ShiftResponse.model_fields


@pytest.mark.asyncio
async def test_handoff_rejects_unassigned_scheduling_viewer():
    user = _user(permissions=("scheduling.view",))
    shift = SimpleNamespace(shift_officer_id=uuid4())
    service = SimpleNamespace(
        get_shift_by_id=AsyncMock(return_value=shift),
        get_shift_assignments=AsyncMock(return_value=[]),
    )

    with pytest.raises(HTTPException) as exc:
        await _authorize_handoff_access(service, user, uuid4())

    assert exc.value.status_code == 403


@pytest.mark.asyncio
async def test_handoff_allows_active_incoming_crew_member():
    user = _user(permissions=("scheduling.view",))
    shift = SimpleNamespace(shift_officer_id=uuid4())
    assignment = SimpleNamespace(
        user_id=user.id,
        assignment_status="assigned",
    )
    service = SimpleNamespace(
        get_shift_by_id=AsyncMock(return_value=shift),
        get_shift_assignments=AsyncMock(return_value=[assignment]),
    )

    assert await _authorize_handoff_access(service, user, uuid4()) is shift
