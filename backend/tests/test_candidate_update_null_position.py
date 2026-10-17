"""`update_candidate` accepts a cleared position, as `create_candidate` does.

`create_candidate` lets a candidate be added with no position even when the
election defines positions (the candidate list shows them as unassigned). The
PATCH handler refused an explicit null against the position list, and because
the edit form resubmits the position on every save, a statement-only edit of
an unassigned candidate was refused with a 400. A position that is set must
still be one the election defines.
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest
from fastapi import HTTPException

from app.api.v1.endpoints import elections as election_endpoints
from app.models.election import ElectionStatus
from app.schemas.election import CandidateUpdate

pytestmark = pytest.mark.unit


def _wire(monkeypatch, position):
    election_id = uuid4()
    candidate_id = uuid4()
    election = SimpleNamespace(
        id=election_id, status=ElectionStatus.DRAFT, positions=["Chief", "Captain"]
    )
    candidate = SimpleNamespace(
        id=str(candidate_id),
        election_id=str(election_id),
        name="Pat Smith",
        position=position,
        statement=None,
        accepted=True,
    )
    service = SimpleNamespace(get_election=AsyncMock(return_value=election))
    monkeypatch.setattr(election_endpoints, "ElectionService", lambda _db: service)
    monkeypatch.setattr(election_endpoints, "log_audit_event", AsyncMock())

    result = MagicMock()
    result.scalar_one_or_none.return_value = candidate
    count_result = MagicMock()
    count_result.scalar.return_value = 0
    db = AsyncMock()
    db.execute = AsyncMock(side_effect=[result, count_result])

    user = SimpleNamespace(id=uuid4(), organization_id=uuid4())
    return election_id, candidate_id, candidate, db, user


async def test_null_position_clears_an_assigned_candidate(monkeypatch):
    election_id, candidate_id, candidate, db, user = _wire(monkeypatch, "Chief")

    await election_endpoints.update_candidate(
        election_id=election_id,
        candidate_id=candidate_id,
        candidate_update=CandidateUpdate(position=None),
        db=db,
        current_user=user,
    )

    assert candidate.position is None
    db.commit.assert_awaited_once()


async def test_statement_edit_of_an_unassigned_candidate_is_accepted(monkeypatch):
    """What the edit form actually sends: the seeded (null) position plus the
    changed field."""
    election_id, candidate_id, candidate, db, user = _wire(monkeypatch, None)

    await election_endpoints.update_candidate(
        election_id=election_id,
        candidate_id=candidate_id,
        candidate_update=CandidateUpdate(
            name="Pat Smith", position=None, statement="Twenty years of service"
        ),
        db=db,
        current_user=user,
    )

    assert candidate.statement == "Twenty years of service"
    assert candidate.position is None
    db.commit.assert_awaited_once()


async def test_a_position_outside_the_list_is_still_refused(monkeypatch):
    election_id, candidate_id, candidate, db, user = _wire(monkeypatch, None)

    with pytest.raises(HTTPException) as exc:
        await election_endpoints.update_candidate(
            election_id=election_id,
            candidate_id=candidate_id,
            candidate_update=CandidateUpdate(position="Treasurer"),
            db=db,
            current_user=user,
        )

    assert exc.value.status_code == 400
    assert "Treasurer" in exc.value.detail
    assert candidate.position is None
    db.commit.assert_not_awaited()
