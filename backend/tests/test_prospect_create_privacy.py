"""Privacy regression tests for duplicate archived-member responses."""

import sys
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import pytest
from fastapi import HTTPException

# Endpoint import only needs libmagic for unrelated upload routes. Keep this
# unit test independent of the host's native libmagic installation.
sys.modules.setdefault("magic", MagicMock())

from app.api.v1.endpoints.membership_pipeline import create_prospect, transfer_prospect
from app.models.membership_pipeline import ProspectStatus
from app.schemas.membership_pipeline import ProspectCreate, TransferProspectRequest


@pytest.mark.unit
async def test_archived_match_conflict_does_not_disclose_member_identity():
    """A name-only match must not reveal the archived member's stored email."""
    submitted_email = "new-address@example.com"
    archived_email = "private-address@example.com"
    service = SimpleNamespace(
        check_existing_members=AsyncMock(
            return_value=[
                {
                    "status": "archived",
                    "match_type": "name",
                    "name": "Private Member",
                    "email": archived_email,
                    "user_id": str(uuid4()),
                }
            ]
        )
    )
    current_user = SimpleNamespace(organization_id=str(uuid4()), id=str(uuid4()))
    data = ProspectCreate(
        first_name="Private",
        last_name="Member",
        email=submitted_email,
    )

    with patch(
        "app.api.v1.endpoints.membership_pipeline.MembershipPipelineService",
        return_value=service,
    ):
        with pytest.raises(HTTPException) as exc_info:
            await create_prospect(data=data, db=AsyncMock(), current_user=current_user)

    assert exc_info.value.status_code == 409
    detail = str(exc_info.value.detail)
    assert "archived members list" in detail
    assert "Private Member" not in detail
    assert archived_email not in detail
    assert "user_id" not in detail


@pytest.mark.unit
async def test_transfer_conflict_does_not_disclose_existing_member_identity():
    """The transfer boundary must not pass through the service's match details."""
    private_email = "archived-private@example.com"
    private_user_id = str(uuid4())
    service = SimpleNamespace(
        get_prospect=AsyncMock(
            return_value=SimpleNamespace(status=ProspectStatus.ACTIVE)
        ),
        transfer_to_membership=AsyncMock(
            return_value={
                "success": False,
                "existing_member_match": {
                    "name": "Archived Person",
                    "email": private_email,
                    "user_id": private_user_id,
                },
                "message": (
                    f"Archived Person ({private_email}); reactivate "
                    f"/users/{private_user_id}"
                ),
            }
        ),
    )
    current_user = SimpleNamespace(
        organization_id=str(uuid4()), id=str(uuid4()), username="coordinator"
    )
    data = TransferProspectRequest(username="new-member")

    request = SimpleNamespace(client=None, headers={})

    with patch(
        "app.api.v1.endpoints.membership_pipeline.MembershipPipelineService",
        return_value=service,
    ):
        with pytest.raises(HTTPException) as exc_info:
            await transfer_prospect(
                prospect_id=uuid4(),
                data=data,
                request=request,
                db=AsyncMock(),
                current_user=current_user,
            )

    assert exc_info.value.status_code == 409
    detail = str(exc_info.value.detail)
    assert "existing members list" in detail
    assert "Archived Person" not in detail
    assert private_email not in detail
    assert private_user_id not in detail


@pytest.mark.unit
async def test_transfer_unknown_prospect_does_not_report_privilege_escalation():
    """PERM-3 follow-up (Codex review on PR #1931): an id that doesn't exist,
    isn't in this org, or was already transferred can never be transferred
    regardless of the requested rank -- checking it must come before the
    rank-grant ceiling, which commits a CRITICAL security alert on denial.
    Otherwise a caller can spam alerts with garbage prospect ids + a reserved
    rank for a transfer that could never have succeeded."""
    service = SimpleNamespace(
        get_prospect=AsyncMock(return_value=None),
        transfer_to_membership=AsyncMock(
            side_effect=AssertionError(
                "transfer_to_membership should not run for an unresolvable prospect"
            )
        ),
    )
    current_user = SimpleNamespace(
        organization_id=str(uuid4()), id=str(uuid4()), username="coordinator"
    )
    data = TransferProspectRequest(username="new-member", rank="fire_chief")
    request = SimpleNamespace(client=None, headers={})

    with patch(
        "app.api.v1.endpoints.membership_pipeline.MembershipPipelineService",
        return_value=service,
    ), patch(
        "app.api.v1.endpoints.membership_pipeline._enforce_rank_grant_ceiling",
        AsyncMock(
            side_effect=AssertionError(
                "the ceiling check must not run before the prospect is resolved"
            )
        ),
    ):
        with pytest.raises(HTTPException) as exc_info:
            await transfer_prospect(
                prospect_id=uuid4(),
                data=data,
                request=request,
                db=AsyncMock(),
                current_user=current_user,
            )

    assert exc_info.value.status_code == 404
