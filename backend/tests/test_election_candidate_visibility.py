"""Regression tests for pending nomination visibility."""

from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest

from app.api.v1.endpoints import elections as election_endpoints
from app.models.election import ElectionStatus


@pytest.mark.parametrize(
    ("election_status", "can_manage", "accepted_only"),
    [
        (ElectionStatus.NOMINATIONS, False, False),
        (ElectionStatus.DRAFT, False, True),
        (ElectionStatus.DRAFT, True, False),
        (ElectionStatus.OPEN, False, True),
    ],
)
async def test_candidate_list_limits_pending_nomination_visibility(
    monkeypatch, election_status, can_manage, accepted_only
):
    """Only managers or members in the nomination phase see pending rows."""
    election_id = uuid4()
    organization_id = uuid4()
    service = SimpleNamespace(
        get_election=AsyncMock(return_value=SimpleNamespace(status=election_status)),
        list_candidates=AsyncMock(return_value=[]),
    )

    monkeypatch.setattr(election_endpoints, "ElectionService", lambda _db: service)
    monkeypatch.setattr(
        election_endpoints,
        "user_has_permission",
        lambda _user, permission: can_manage and permission == "elections.manage",
    )

    await election_endpoints.list_candidates(
        election_id=election_id,
        db=AsyncMock(),
        current_user=SimpleNamespace(organization_id=organization_id),
    )

    service.get_election.assert_awaited_once_with(election_id, organization_id)
    service.list_candidates.assert_awaited_once_with(
        election_id, accepted_only=accepted_only
    )
