"""`update_candidate` must respect the election lifecycle and position list.

`add_candidate` refuses a closed election and rejects a position that is
not one of `election.positions`; `delete_candidate` refuses a candidate who
has votes. The PATCH sibling checked neither, so after the polls closed a
manager could rename the winner or move a candidate to another position —
and because vote signatures embed `candidate_id`, not the name or position,
integrity verification still reported the votes as untampered.
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


def _wire(monkeypatch, election_status, positions, active_votes=0):
    """Stand the handler up over a stubbed service and session.

    ``active_votes`` is what the vote-count read (the handler's second
    ``db.execute``) reports, so the votes-cast freeze can be exercised."""
    election_id = uuid4()
    candidate_id = uuid4()
    org_id = uuid4()
    election = SimpleNamespace(
        id=election_id, status=election_status, positions=positions
    )
    candidate = SimpleNamespace(
        id=str(candidate_id),
        election_id=str(election_id),
        name="Original Name",
        position=positions[0],
        accepted=True,
    )
    service = SimpleNamespace(get_election=AsyncMock(return_value=election))
    monkeypatch.setattr(election_endpoints, "ElectionService", lambda _db: service)
    monkeypatch.setattr(election_endpoints, "log_audit_event", AsyncMock())

    result = MagicMock()
    result.scalar_one_or_none.return_value = candidate
    count_result = MagicMock()
    count_result.scalar.return_value = active_votes
    db = AsyncMock()
    db.execute = AsyncMock(side_effect=[result, count_result])

    user = SimpleNamespace(id=uuid4(), organization_id=org_id)
    return election_id, candidate_id, candidate, db, user


async def test_closed_election_rejects_candidate_rename(monkeypatch):
    election_id, candidate_id, candidate, db, user = _wire(
        monkeypatch, ElectionStatus.CLOSED, ["Chief"]
    )

    with pytest.raises(HTTPException) as exc:
        await election_endpoints.update_candidate(
            election_id=election_id,
            candidate_id=candidate_id,
            candidate_update=CandidateUpdate(name="Someone Else"),
            db=db,
            current_user=user,
        )

    assert exc.value.status_code == 400
    assert candidate.name == "Original Name"
    db.commit.assert_not_awaited()


async def test_position_must_be_one_the_election_defines(monkeypatch):
    election_id, candidate_id, candidate, db, user = _wire(
        monkeypatch, ElectionStatus.DRAFT, ["Chief", "Captain"]
    )

    with pytest.raises(HTTPException) as exc:
        await election_endpoints.update_candidate(
            election_id=election_id,
            candidate_id=candidate_id,
            candidate_update=CandidateUpdate(position="Treasurer"),
            db=db,
            current_user=user,
        )

    assert exc.value.status_code == 400
    assert candidate.position == "Chief"
    db.commit.assert_not_awaited()


async def test_statement_only_edit_is_allowed_once_votes_exist(monkeypatch):
    """The edit form resubmits the name and position it was seeded with, so
    the freeze must compare values, not keys — otherwise no statement can be
    corrected during any election with a single vote."""
    election_id, candidate_id, candidate, db, user = _wire(
        monkeypatch, ElectionStatus.OPEN, ["Chief"], active_votes=3
    )

    await election_endpoints.update_candidate(
        election_id=election_id,
        candidate_id=candidate_id,
        candidate_update=CandidateUpdate(
            name="Original Name", position="Chief", statement="Updated statement"
        ),
        db=db,
        current_user=user,
    )

    assert candidate.statement == "Updated statement"
    assert candidate.name == "Original Name"
    db.commit.assert_awaited_once()


async def test_rename_is_refused_once_votes_exist(monkeypatch):
    election_id, candidate_id, candidate, db, user = _wire(
        monkeypatch, ElectionStatus.OPEN, ["Chief"], active_votes=1
    )

    with pytest.raises(HTTPException) as exc:
        await election_endpoints.update_candidate(
            election_id=election_id,
            candidate_id=candidate_id,
            candidate_update=CandidateUpdate(name="Someone Else", position="Chief"),
            db=db,
            current_user=user,
        )

    assert exc.value.status_code == 400
    assert "once votes have been cast" in exc.value.detail
    assert candidate.name == "Original Name"
    db.commit.assert_not_awaited()
