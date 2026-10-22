"""A deleted saved report cannot be edited or run by its id.

``DELETE /reports/saved/{id}`` is a soft delete (``is_active = False``). The
list hid the row, but ``PATCH /reports/saved/{id}`` and
``POST /reports/saved/{id}/run`` looked it up by id and organization alone, so
anyone holding the id could still edit a deleted report or run it. Both now
answer 404, as they do for a report that never existed.
"""

import uuid
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.endpoints import reports as reports_ep
from app.models.analytics import SavedReport
from app.schemas.reports import SavedReportUpdate

pytestmark = [pytest.mark.integration]


async def _saved_report(db: AsyncSession, org_id: str, *, is_active: bool) -> str:
    report = SavedReport(
        id=str(uuid.uuid4()),
        organization_id=org_id,
        name="Monthly call volume",
        report_type="call_volume",
        filters={},
        is_scheduled=False,
        is_active=is_active,
    )
    db.add(report)
    await db.flush()
    return str(report.id)


def _manager(org_id: str, admin_id: str) -> SimpleNamespace:
    return SimpleNamespace(id=admin_id, organization_id=org_id)


class TestDeletedSavedReport:
    async def test_patch_of_a_deleted_report_is_404(
        self, db_session: AsyncSession, setup_org_and_admin
    ):
        org_id, admin_id = setup_org_and_admin
        report_id = await _saved_report(db_session, org_id, is_active=False)

        with pytest.raises(HTTPException) as exc:
            await reports_ep.update_saved_report(
                report_id,
                SavedReportUpdate(name="Renamed"),
                db=db_session,
                current_user=_manager(org_id, admin_id),
            )

        assert exc.value.status_code == 404
        db_session.expire_all()
        name = await db_session.scalar(
            select(SavedReport.name).where(SavedReport.id == report_id)
        )
        assert name == "Monthly call volume"

    async def test_run_of_a_deleted_report_is_404(
        self, db_session: AsyncSession, setup_org_and_admin
    ):
        org_id, admin_id = setup_org_and_admin
        report_id = await _saved_report(db_session, org_id, is_active=False)

        with pytest.raises(HTTPException) as exc:
            await reports_ep.run_saved_report(
                report_id,
                db=db_session,
                current_user=_manager(org_id, admin_id),
                hidden_prospect_ids=set(),
            )

        assert exc.value.status_code == 404
        db_session.expire_all()
        last_run = await db_session.scalar(
            select(SavedReport.last_run_at).where(SavedReport.id == report_id)
        )
        assert last_run is None

    async def test_patch_of_an_active_report_still_works(
        self, db_session: AsyncSession, setup_org_and_admin
    ):
        org_id, admin_id = setup_org_and_admin
        report_id = await _saved_report(db_session, org_id, is_active=True)

        updated = await reports_ep.update_saved_report(
            report_id,
            SavedReportUpdate(name="Renamed"),
            db=db_session,
            current_user=_manager(org_id, admin_id),
        )

        assert updated.name == "Renamed"

    async def test_another_orgs_active_report_is_still_404(
        self, db_session: AsyncSession, setup_org_and_admin
    ):
        org_id, admin_id = setup_org_and_admin
        report_id = await _saved_report(db_session, org_id, is_active=True)

        with pytest.raises(HTTPException) as exc:
            await reports_ep.update_saved_report(
                report_id,
                SavedReportUpdate(name="Renamed"),
                db=db_session,
                current_user=_manager(str(uuid.uuid4()), admin_id),
            )

        assert exc.value.status_code == 404
