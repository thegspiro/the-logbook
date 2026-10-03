"""The coordinator's notes from the Convert dialog are kept.

The dialog collected "Notes (optional)", but the transfer request had no field
for them and the client never sent them, so they were discarded without a
word. They now travel with the transfer and are recorded on the prospect's
``transferred_to_membership`` activity entry -- the prospect is closed by the
transfer, and its activity log is where the coordinator's reasoning is read
back from.
"""

import uuid
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from pydantic import ValidationError
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.endpoints import membership_pipeline as pipeline_ep
from app.models.membership_pipeline import ProspectActivityLog, ProspectStatus
from app.schemas.membership_pipeline import TransferProspectRequest
from app.services.membership_pipeline_service import MembershipPipelineService

SERVICE = "app.services.membership_pipeline_service.MembershipPipelineService"


def _uid() -> str:
    return str(uuid.uuid4())


@pytest.mark.unit
class TestTheRequest:
    def test_notes_are_optional(self):
        assert TransferProspectRequest().notes is None

    def test_notes_are_accepted(self):
        assert TransferProspectRequest(notes="Cleared.").notes == "Cleared."

    def test_notes_are_bounded(self):
        TransferProspectRequest(notes="x" * 2000)
        with pytest.raises(ValidationError):
            TransferProspectRequest(notes="x" * 2001)

    async def test_the_endpoint_passes_the_notes_to_the_service(self):
        prospect = SimpleNamespace(status=ProspectStatus.ACTIVE, target_role_id=None)
        service_transfer = AsyncMock(
            return_value={"success": True, "user_id": "u-new", "message": "ok"}
        )
        with patch(
            f"{SERVICE}.get_prospect", new=AsyncMock(return_value=prospect)
        ), patch(
            f"{SERVICE}.transfer_to_membership", new=service_transfer
        ), patch.object(
            pipeline_ep, "_canonical_rank_or_400", new=AsyncMock(return_value=None)
        ), patch.object(
            pipeline_ep, "_enforce_rank_grant_ceiling", new=AsyncMock()
        ), patch.object(
            pipeline_ep, "log_audit_event", new=AsyncMock()
        ):
            await pipeline_ep.transfer_prospect(
                prospect_id=uuid.uuid4(),
                data=TransferProspectRequest(notes="Cleared by the chief."),
                request=MagicMock(),
                db=MagicMock(),
                current_user=SimpleNamespace(
                    id="admin-1", organization_id="org-a", username="admin"
                ),
            )

        assert service_transfer.await_args.kwargs["notes"] == "Cleared by the chief."


async def _org(db_session: AsyncSession) -> str:
    org_id = _uid()
    await db_session.execute(
        text(
            "INSERT INTO organizations (id, name, organization_type, slug, timezone)"
            " VALUES (:id, 'Dept', 'fire_department', :slug, 'UTC')"
        ),
        {"id": org_id, "slug": f"d-{org_id[:8]}"},
    )
    await db_session.flush()
    return org_id


async def _transfer_details(db_session: AsyncSession, **transfer) -> dict:
    org_id = await _org(db_session)
    svc = MembershipPipelineService(db_session)
    pipeline = await svc.create_pipeline(organization_id=org_id, name="P")
    prospect = await svc.create_prospect(
        organization_id=org_id,
        data={
            "first_name": "Jordan",
            "last_name": f"Hale{_uid()[:4]}",
            "email": f"j-{_uid()[:8]}@example.com",
            "pipeline_id": str(pipeline.id),
        },
    )

    result = await svc.transfer_to_membership(
        prospect_id=str(prospect.id),
        organization_id=org_id,
        transferred_by=None,
        **transfer,
    )
    assert result["success"] is True, result

    entry = (
        await db_session.execute(
            select(ProspectActivityLog).where(
                ProspectActivityLog.prospect_id == str(prospect.id),
                ProspectActivityLog.action == "transferred_to_membership",
            )
        )
    ).scalar_one()
    return entry.details


@pytest.mark.integration
class TestTheActivityLog:
    async def test_the_notes_are_recorded_with_the_transfer(
        self, db_session: AsyncSession
    ):
        details = await _transfer_details(
            db_session, notes="  Cleared by the chief on 9/28.  "
        )

        assert details["notes"] == "Cleared by the chief on 9/28."

    async def test_no_notes_records_no_notes_key(self, db_session: AsyncSession):
        details = await _transfer_details(db_session, notes="   ")

        assert "notes" not in details
