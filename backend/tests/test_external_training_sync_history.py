"""
The sync-history view lists a provider's runs and, for each run, the classes
it brought in. The second half rests on the imports endpoint narrowing to one
run, and on that narrowing staying inside the caller's organization.
"""

import uuid
from datetime import datetime, timezone
from types import SimpleNamespace

import pytest

from app.api.v1.endpoints.external_training import list_imported_records
from app.models.training import (
    ExternalProviderType,
    ExternalTrainingImport,
    ExternalTrainingProvider,
    ExternalTrainingSyncLog,
    SyncStatus,
)
from app.models.user import Organization

pytestmark = [pytest.mark.integration]


async def _provider(db_session) -> ExternalTrainingProvider:
    org = Organization(
        id=str(uuid.uuid4()),
        name="Sync History Department",
        slug=f"sh-{uuid.uuid4().hex[:8]}",
    )
    db_session.add(org)
    await db_session.flush()
    provider = ExternalTrainingProvider(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        name="Vector Solutions",
        provider_type=ExternalProviderType.VECTOR_SOLUTIONS,
        api_base_url="https://example.test/api/",
    )
    db_session.add(provider)
    await db_session.flush()
    return provider


async def _run(db_session, provider) -> ExternalTrainingSyncLog:
    log = ExternalTrainingSyncLog(
        id=str(uuid.uuid4()),
        provider_id=provider.id,
        organization_id=provider.organization_id,
        sync_type="incremental",
        status=SyncStatus.COMPLETED,
        started_at=datetime.now(timezone.utc),
    )
    db_session.add(log)
    await db_session.flush()
    return log


async def _staged(db_session, provider, log, title) -> ExternalTrainingImport:
    row = ExternalTrainingImport(
        id=str(uuid.uuid4()),
        provider_id=provider.id,
        organization_id=provider.organization_id,
        sync_log_id=log.id if log else None,
        external_record_id=f"R-{uuid.uuid4().hex[:8]}",
        course_title=title,
        import_status="imported",
    )
    db_session.add(row)
    await db_session.flush()
    return row


async def _list(db_session, provider, org_id, sync_log_id=None):
    return await list_imported_records(
        provider_id=uuid.UUID(provider.id),
        status=None,
        sync_log_id=uuid.UUID(sync_log_id) if sync_log_id else None,
        limit=200,
        offset=0,
        db=db_session,
        current_user=SimpleNamespace(organization_id=org_id),
    )


class TestImportsByRun:
    async def test_only_the_runs_classes_are_listed(self, db_session):
        provider = await _provider(db_session)
        first = await _run(db_session, provider)
        second = await _run(db_session, provider)
        await _staged(db_session, provider, first, "Hazmat Awareness")
        await _staged(db_session, provider, second, "Ladder Operations")
        await _staged(db_session, provider, None, "Uploaded Before Runs Were Kept")

        rows = await _list(db_session, provider, provider.organization_id, first.id)

        assert [r.course_title for r in rows] == ["Hazmat Awareness"]

    async def test_without_a_run_every_record_is_listed(self, db_session):
        provider = await _provider(db_session)
        run = await _run(db_session, provider)
        await _staged(db_session, provider, run, "Hazmat Awareness")
        await _staged(db_session, provider, None, "Ladder Operations")

        rows = await _list(db_session, provider, provider.organization_id)

        assert {r.course_title for r in rows} == {
            "Hazmat Awareness",
            "Ladder Operations",
        }

    async def test_another_departments_run_reads_as_empty(self, db_session):
        provider = await _provider(db_session)
        run = await _run(db_session, provider)
        await _staged(db_session, provider, run, "Hazmat Awareness")
        other = await _provider(db_session)

        rows = await _list(db_session, provider, other.organization_id, run.id)

        assert rows == []
