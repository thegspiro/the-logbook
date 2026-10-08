"""Purging inactive applications deletes them, and their files.

The Inactive Applications tab's Purge button reached a service that deleted
only WITHDRAWN rows, so every purge from that tab matched nothing and the page
reported success over data it had kept. The bulk row delete also cascaded to
``prospect_documents`` in the database but left the uploaded files -- ID
photos, background checks -- on disk.
"""

import uuid
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.endpoints.membership_pipeline import purge_inactive_prospects
from app.models.membership_pipeline import (
    ProspectDocument,
    ProspectiveMember,
    ProspectStatus,
)
from app.schemas.membership_pipeline import PurgeInactiveRequest
from app.services import membership_pipeline_service
from app.services.membership_pipeline_service import MembershipPipelineService

pytestmark = [pytest.mark.integration]


@pytest.fixture(autouse=True)
def _prospect_storage(tmp_path, monkeypatch):
    """Point applicant storage at tmp_path; files go under ``<org_id>/``.

    Purge only ever unlinks inside the organization's own subtree, so a
    fixture file has to live there to be the organization's file at all.
    """
    monkeypatch.setattr(
        membership_pipeline_service, "PROSPECT_DOCUMENT_DIR", str(tmp_path)
    )


def _uid() -> str:
    return str(uuid.uuid4())


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


async def _prospect(svc, db_session, org_id, pipeline_id, status):
    prospect = await svc.create_prospect(
        organization_id=org_id,
        data={
            "first_name": "App",
            "last_name": f"Licant{_uid()[:4]}",
            "email": f"a-{_uid()[:8]}@example.com",
            "pipeline_id": pipeline_id,
        },
    )
    prospect.status = status
    await db_session.flush()
    return prospect


async def _exists(db_session, prospect_id) -> bool:
    found = await db_session.execute(
        select(ProspectiveMember.id).where(ProspectiveMember.id == prospect_id)
    )
    return found.scalar_one_or_none() is not None


@pytest.fixture
async def pipeline(db_session: AsyncSession):
    org_id = await _org(db_session)
    svc = MembershipPipelineService(db_session)
    created = await svc.create_pipeline(organization_id=org_id, name="P")
    return svc, org_id, str(created.id)


class TestWhatIsPurged:
    async def test_the_selected_inactive_applications_are_deleted(
        self, db_session: AsyncSession, pipeline
    ):
        svc, org_id, pipeline_id = pipeline
        a = await _prospect(
            svc, db_session, org_id, pipeline_id, ProspectStatus.INACTIVE
        )
        b = await _prospect(
            svc, db_session, org_id, pipeline_id, ProspectStatus.INACTIVE
        )

        count = await svc.purge_inactive_prospects(
            pipeline_id, org_id, prospect_ids=[str(a.id), str(b.id)]
        )

        assert count == 2
        assert not await _exists(db_session, a.id)
        assert not await _exists(db_session, b.id)

    @pytest.mark.parametrize(
        "status",
        [
            ProspectStatus.ACTIVE,
            ProspectStatus.ON_HOLD,
            ProspectStatus.WITHDRAWN,
            ProspectStatus.REJECTED,
        ],
    )
    async def test_other_statuses_are_kept_and_not_counted(
        self, db_session: AsyncSession, pipeline, status
    ):
        # Includes WITHDRAWN: the tab this backs lists inactive applications,
        # and the owner chose to keep purge to exactly those.
        svc, org_id, pipeline_id = pipeline
        kept = await _prospect(svc, db_session, org_id, pipeline_id, status)
        gone = await _prospect(
            svc, db_session, org_id, pipeline_id, ProspectStatus.INACTIVE
        )

        count = await svc.purge_inactive_prospects(
            pipeline_id, org_id, prospect_ids=[str(kept.id), str(gone.id)]
        )

        assert count == 1
        assert await _exists(db_session, kept.id)
        assert not await _exists(db_session, gone.id)

    async def test_another_organizations_pipeline_purges_nothing(
        self, db_session: AsyncSession, pipeline
    ):
        svc, org_id, pipeline_id = pipeline
        target = await _prospect(
            svc, db_session, org_id, pipeline_id, ProspectStatus.INACTIVE
        )
        other_org = await _org(db_session)

        count = await svc.purge_inactive_prospects(
            pipeline_id, other_org, prospect_ids=[str(target.id)]
        )

        assert count == 0
        assert await _exists(db_session, target.id)


class TestUploadedFiles:
    async def _with_document(self, db_session, prospect, path):
        path.write_bytes(b"scanned licence")
        db_session.add(
            ProspectDocument(
                prospect_id=prospect.id,
                document_type="id",
                file_name=path.name,
                file_path=str(path),
            )
        )
        await db_session.flush()

    async def test_a_purged_applicants_files_are_removed(
        self, db_session: AsyncSession, pipeline, tmp_path
    ):
        svc, org_id, pipeline_id = pipeline
        prospect = await _prospect(
            svc, db_session, org_id, pipeline_id, ProspectStatus.INACTIVE
        )
        stored = tmp_path / org_id / "licence.jpg"
        stored.parent.mkdir(parents=True, exist_ok=True)
        await self._with_document(db_session, prospect, stored)

        await svc.purge_inactive_prospects(
            pipeline_id, org_id, prospect_ids=[str(prospect.id)]
        )

        assert not stored.exists()

    async def test_a_file_already_gone_does_not_block_the_purge(
        self, db_session: AsyncSession, pipeline, tmp_path
    ):
        # What a retry after a partial failure looks like.
        svc, org_id, pipeline_id = pipeline
        prospect = await _prospect(
            svc, db_session, org_id, pipeline_id, ProspectStatus.INACTIVE
        )
        stored = tmp_path / org_id / "licence.jpg"
        stored.parent.mkdir(parents=True, exist_ok=True)
        await self._with_document(db_session, prospect, stored)
        stored.unlink()

        count = await svc.purge_inactive_prospects(
            pipeline_id, org_id, prospect_ids=[str(prospect.id)]
        )

        assert count == 1

    async def test_a_file_that_cannot_be_removed_keeps_the_rows(
        self, db_session: AsyncSession, pipeline, tmp_path
    ):
        # The row is the only record that the file still needs removing.
        svc, org_id, pipeline_id = pipeline
        prospect = await _prospect(
            svc, db_session, org_id, pipeline_id, ProspectStatus.INACTIVE
        )
        stored = tmp_path / org_id / "licence.jpg"
        stored.parent.mkdir(parents=True, exist_ok=True)
        await self._with_document(db_session, prospect, stored)

        with patch("os.remove", side_effect=PermissionError("read-only")):
            with pytest.raises(ValueError, match="nothing was purged"):
                await svc.purge_inactive_prospects(
                    pipeline_id, org_id, prospect_ids=[str(prospect.id)]
                )

        assert await _exists(db_session, prospect.id)
        assert stored.exists()


class TestTheEndpoint:
    def _caller(self, org_id):
        return SimpleNamespace(
            id=_uid(), organization_id=org_id, username="coordinator"
        )

    async def test_it_reports_the_real_count_and_records_the_purge(
        self, db_session: AsyncSession, pipeline
    ):
        svc, org_id, pipeline_id = pipeline
        gone = await _prospect(
            svc, db_session, org_id, pipeline_id, ProspectStatus.INACTIVE
        )
        kept = await _prospect(
            svc, db_session, org_id, pipeline_id, ProspectStatus.WITHDRAWN
        )

        with patch(
            "app.api.v1.endpoints.membership_pipeline.log_audit_event",
            new=AsyncMock(),
        ) as audited:
            response = await purge_inactive_prospects(
                pipeline_id=uuid.UUID(pipeline_id),
                data=PurgeInactiveRequest(
                    prospect_ids=[gone.id, kept.id], confirm=True
                ),
                db=db_session,
                current_user=self._caller(org_id),
            )

        assert response.purged_count == 1
        assert response.message == "Purged 1 inactive application(s)"
        audited.assert_awaited_once()
        event = audited.await_args.kwargs
        assert event["event_type"] == "membership_pipeline.prospects_purged"
        assert event["event_data"]["purged_count"] == 1

    async def test_a_file_failure_is_a_400_not_a_500(
        self, db_session: AsyncSession, pipeline, tmp_path
    ):
        svc, org_id, pipeline_id = pipeline
        prospect = await _prospect(
            svc, db_session, org_id, pipeline_id, ProspectStatus.INACTIVE
        )
        stored = tmp_path / org_id / "licence.jpg"
        stored.parent.mkdir(parents=True, exist_ok=True)
        stored.write_bytes(b"x")
        db_session.add(
            ProspectDocument(
                prospect_id=prospect.id,
                document_type="id",
                file_name="licence.jpg",
                file_path=str(stored),
            )
        )
        await db_session.flush()

        with patch("os.remove", side_effect=PermissionError("read-only")):
            with pytest.raises(HTTPException) as refused:
                await purge_inactive_prospects(
                    pipeline_id=uuid.UUID(pipeline_id),
                    data=PurgeInactiveRequest(prospect_ids=[prospect.id], confirm=True),
                    db=db_session,
                    current_user=self._caller(org_id),
                )

        assert refused.value.status_code == 400
