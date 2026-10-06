"""MS-12: every medical-screening read that returns PHI writes one audit event.

HIPAA's audit-control standard (§164.312(b)) covers access to PHI, not only
changes to it. The six write routes were audited; the five reads that return
screening results, statuses and dates were not, so who opened a member's
drug-screening result was undiscoverable. Owner decision: one event per
request, naming the subject(s) returned or the filter applied — never one per
row.

Integration: the assertion is on the ``audit_logs`` rows the request leaves,
which a mocked session would only pretend to write.
"""

import uuid
from datetime import date, timedelta
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import PaginationParams
from app.api.v1.endpoints import medical_screening as ep
from app.models.audit import AuditLog
from app.models.medical_screening import (
    ScreeningRecord,
    ScreeningStatus,
    ScreeningType,
)

pytestmark = [pytest.mark.integration]


def _uid() -> str:
    return str(uuid.uuid4())


@pytest.fixture
async def scene(db_session: AsyncSession, setup_org_and_admin):
    """An officer, a member with two screenings, and a prospect with one."""
    org_id, officer_id = setup_org_and_admin
    member_id = _uid()
    await db_session.execute(
        text(
            "INSERT INTO users (id, organization_id, username, first_name, "
            "last_name, email, password_hash, status) "
            "VALUES (:id, :org, :un, 'Pat', 'Member', :em, 'x', 'active')"
        ),
        {
            "id": member_id,
            "org": org_id,
            "un": f"m-{member_id[:8]}",
            "em": f"m-{member_id[:8]}@test.com",
        },
    )
    prospect_id = _uid()
    await db_session.execute(
        text(
            "INSERT INTO prospective_members (id, organization_id, first_name, "
            "last_name, email) VALUES (:id, :org, 'Sam', 'Applicant', :em)"
        ),
        {"id": prospect_id, "org": org_id, "em": f"p-{prospect_id[:8]}@test.com"},
    )
    soon = date.today() + timedelta(days=10)
    records = [
        ScreeningRecord(
            id=_uid(),
            organization_id=org_id,
            user_id=member_id,
            screening_type=ScreeningType.DRUG_SCREENING,
            status=ScreeningStatus.PASSED,
            expiration_date=soon,
        ),
        ScreeningRecord(
            id=_uid(),
            organization_id=org_id,
            user_id=member_id,
            screening_type=ScreeningType.PHYSICAL_EXAM,
            status=ScreeningStatus.PASSED,
        ),
        ScreeningRecord(
            id=_uid(),
            organization_id=org_id,
            prospect_id=prospect_id,
            screening_type=ScreeningType.PSYCHOLOGICAL,
            status=ScreeningStatus.PASSED,
            expiration_date=soon,
        ),
    ]
    db_session.add_all(records)
    await db_session.flush()
    officer = SimpleNamespace(id=officer_id, organization_id=org_id, username="cpt")
    return SimpleNamespace(
        officer=officer,
        member_id=member_id,
        prospect_id=prospect_id,
        records=records,
    )


async def _events(db: AsyncSession, actor_id: str, event_type: str) -> list:
    result = await db.execute(
        select(AuditLog).where(
            AuditLog.user_id == actor_id, AuditLog.event_type == event_type
        )
    )
    return list(result.scalars().all())


class TestListReadsLogOncePerRequest:
    async def test_records_list(self, db_session, scene):
        rows = await ep.list_records(
            user_id=None,
            prospect_id=None,
            screening_type=None,
            record_status=None,
            pagination=PaginationParams(skip=0, limit=100),
            db=db_session,
            current_user=scene.officer,
        )
        assert len(rows) == 3
        events = await _events(
            db_session, scene.officer.id, "medical_screening.records_viewed"
        )
        # Three rows returned, one event written.
        assert len(events) == 1
        data = events[0].event_data
        assert data["record_count"] == 3
        assert data["subject_user_ids"] == [scene.member_id]
        assert data["subject_prospect_ids"] == [scene.prospect_id]
        assert events[0].event_category == "medical_screening"

    async def test_records_list_names_the_filter(self, db_session, scene):
        await ep.list_records(
            user_id=scene.member_id,
            prospect_id=None,
            screening_type="drug_screening",
            record_status=None,
            pagination=PaginationParams(skip=0, limit=100),
            db=db_session,
            current_user=scene.officer,
        )
        (event,) = await _events(
            db_session, scene.officer.id, "medical_screening.records_viewed"
        )
        assert event.event_data["filters"]["user_id"] == scene.member_id
        assert event.event_data["filters"]["screening_type"] == "drug_screening"
        assert event.event_data["record_count"] == 1

    async def test_expiring_list(self, db_session, scene):
        rows = await ep.get_expiring_screenings(
            days=30, db=db_session, current_user=scene.officer
        )
        assert len(rows) == 2
        (event,) = await _events(
            db_session, scene.officer.id, "medical_screening.expiring_viewed"
        )
        assert event.event_data["filters"] == {"days": 30}
        assert event.event_data["record_count"] == 2
        assert event.event_data["subject_user_ids"] == [scene.member_id]
        assert event.event_data["subject_prospect_ids"] == [scene.prospect_id]


class TestSubjectReadsNameTheSubject:
    async def test_single_record(self, db_session, scene):
        record = scene.records[0]
        await ep.get_record(
            record_id=record.id, db=db_session, current_user=scene.officer
        )
        (event,) = await _events(
            db_session, scene.officer.id, "medical_screening.record_viewed"
        )
        assert event.event_data == {
            "record_id": record.id,
            "record_user_id": scene.member_id,
            "record_prospect_id": None,
        }

    async def test_missing_record_is_not_logged_as_a_view(self, db_session, scene):
        with pytest.raises(HTTPException):
            await ep.get_record(
                record_id=_uid(), db=db_session, current_user=scene.officer
            )
        assert not await _events(
            db_session, scene.officer.id, "medical_screening.record_viewed"
        )

    async def test_member_compliance(self, db_session, scene):
        await ep.get_user_compliance(
            user_id=scene.member_id, db=db_session, current_user=scene.officer
        )
        (event,) = await _events(
            db_session, scene.officer.id, "medical_screening.compliance_viewed"
        )
        assert event.event_data == {
            "subject_type": "user",
            "subject_id": scene.member_id,
        }

    async def test_prospect_compliance(self, db_session, scene):
        await ep.get_prospect_compliance(
            prospect_id=scene.prospect_id,
            db=db_session,
            current_user=scene.officer,
        )
        (event,) = await _events(
            db_session, scene.officer.id, "medical_screening.compliance_viewed"
        )
        assert event.event_data == {
            "subject_type": "prospect",
            "subject_id": scene.prospect_id,
        }


async def test_own_dashboard_counts_are_not_logged(db_session, scene):
    """``/compliance/me`` discloses only the caller's own counts and loads on
    every dashboard visit; logging it would bury the reads that matter."""
    me = SimpleNamespace(
        id=scene.member_id, organization_id=scene.officer.organization_id
    )
    await ep.get_my_compliance(db=db_session, current_user=me)
    result = await db_session.execute(
        select(AuditLog).where(
            AuditLog.user_id == scene.member_id,
            AuditLog.event_category == "medical_screening",
        )
    )
    assert result.scalars().first() is None
