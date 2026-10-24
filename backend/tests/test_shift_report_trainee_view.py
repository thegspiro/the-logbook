"""
A trainee's view of a shift report must not write to the stored report.

The trainee endpoints hide fields the department keeps from trainees (the
officer's narrative, the reviewer's notes, and whatever else the training
config hides). They used to do it by setting those attributes to None on the
session-attached ORM row, and ``get_db`` commits at the end of every request —
reads included — so opening My Reports erased them from the database for the
officer and reviewer too.
"""

import uuid
from datetime import date
from types import SimpleNamespace

import pytest
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.endpoints import shift_completion as endpoint
from app.models.training import ShiftCompletionReport
from app.services.shift_completion_service import ShiftCompletionService

pytestmark = [pytest.mark.integration]


def _uid() -> str:
    return str(uuid.uuid4())


@pytest.fixture
async def released_report(db_session: AsyncSession):
    org_id, officer_id, trainee_id = _uid(), _uid(), _uid()
    await db_session.execute(
        text(
            "INSERT INTO organizations (id, name, organization_type, slug, timezone) "
            "VALUES (:id, 'Test FD', 'fire_department', :slug, 'America/New_York')"
        ),
        {"id": org_id, "slug": f"test-{org_id[:8]}"},
    )
    for uid, uname in [(officer_id, "captain1"), (trainee_id, "probie1")]:
        await db_session.execute(
            text(
                "INSERT INTO users (id, organization_id, username, first_name, "
                "last_name, email, password_hash, status) "
                "VALUES (:id, :org, :un, 'A', 'B', :em, 'hashed', 'active')"
            ),
            {"id": uid, "org": org_id, "un": uname, "em": f"{uname}@test.com"},
        )
    await db_session.flush()

    report = await ShiftCompletionService(db_session).create_report(
        organization_id=uuid.UUID(org_id),
        officer_id=uuid.UUID(officer_id),
        trainee_id=trainee_id,
        shift_date=date.today(),
        hours_on_shift=12.0,
        officer_narrative="Hesitated at the hydrant; talk it through.",
        review_status="approved",
    )
    report.reviewer_notes = "Discussed with the captain."
    await db_session.flush()

    trainee = SimpleNamespace(
        id=trainee_id,
        organization_id=org_id,
        positions=[],
        rank=None,
    )
    return report.id, trainee


async def _stored(db_session: AsyncSession, report_id: str) -> ShiftCompletionReport:
    await db_session.flush()
    db_session.expire_all()
    result = await db_session.execute(
        select(ShiftCompletionReport).where(ShiftCompletionReport.id == report_id)
    )
    return result.scalar_one()


class TestTraineeViewLeavesStoredReportIntact:
    async def test_my_reports_hides_fields_without_erasing_them(
        self, db_session, released_report
    ):
        report_id, trainee = released_report

        reports = await endpoint.get_my_shift_reports(
            start_date=None, end_date=None, db=db_session, current_user=trainee
        )

        assert [r.id for r in reports] == [report_id]
        assert reports[0].officer_narrative is None
        assert reports[0].reviewer_notes is None

        stored = await _stored(db_session, report_id)
        assert stored.officer_narrative == "Hesitated at the hydrant; talk it through."
        assert stored.reviewer_notes == "Discussed with the captain."

    async def test_single_report_hides_fields_without_erasing_them(
        self, db_session, released_report
    ):
        report_id, trainee = released_report

        report = await endpoint.get_shift_report(
            report_id, db=db_session, current_user=trainee
        )

        assert report.officer_narrative is None
        assert report.reviewer_notes is None

        stored = await _stored(db_session, report_id)
        assert stored.officer_narrative == "Hesitated at the hydrant; talk it through."
        assert stored.reviewer_notes == "Discussed with the captain."
