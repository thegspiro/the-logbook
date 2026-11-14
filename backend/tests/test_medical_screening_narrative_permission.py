"""MS-14: the clinical narrative needs ``medical_screening.view_details``.

Owner decision 2026-11-01: ``medical_screening.view`` covers compliance status
— who is due, the dates, the requirement, a passed/failed/waived outcome — and
a new permission covers the clinical narrative a record carries: the examining
provider, the result summary, the structured results and the notes
(``NARRATIVE_FIELDS``). Before this, anyone granted ``.view`` read every
member's narrative. ``.manage`` reads it too, because the edit form that
writes those fields has to show them.

Integration for the endpoint half: the record comes back from the real table
with its encrypted columns decrypted, and the audit row is real.
"""

import uuid
from datetime import date, timedelta
from types import SimpleNamespace

import pytest
from sqlalchemy import select, text

from app.api.dependencies import PaginationParams
from app.api.v1.endpoints import medical_screening as ep
from app.core.permissions import get_all_permissions
from app.models.audit import AuditLog
from app.models.medical_screening import (
    ScreeningRecord,
    ScreeningStatus,
    ScreeningType,
)
from app.schemas.medical_screening import NARRATIVE_FIELDS
from app.services.mfa_policy import is_privileged

VIEW_DETAILS = "medical_screening.view_details"


def _caller(org_id, user_id, *grants):
    return SimpleNamespace(
        id=user_id,
        organization_id=org_id,
        username="caller",
        positions=[SimpleNamespace(permissions=list(grants))],
        rank=None,
    )


@pytest.mark.unit
class TestThePermissionIsRegistered:
    def test_it_is_assignable_to_a_position(self):
        assert VIEW_DETAILS in get_all_permissions()

    def test_holding_it_requires_mfa(self):
        # It reads PHI, like the other two medical screening grants.
        assert is_privileged([VIEW_DETAILS])

    def test_the_narrative_is_the_four_clinical_fields(self):
        assert set(NARRATIVE_FIELDS) == {
            "provider_name",
            "result_summary",
            "result_data",
            "notes",
        }


@pytest.fixture
async def scene(db_session, setup_org_and_admin):
    org_id, officer_id = setup_org_and_admin
    member_id = str(uuid.uuid4())
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
    record = ScreeningRecord(
        id=str(uuid.uuid4()),
        organization_id=org_id,
        user_id=member_id,
        screening_type=ScreeningType.PSYCHOLOGICAL,
        status=ScreeningStatus.PASSED,
        completed_date=date.today() - timedelta(days=3),
        expiration_date=date.today() + timedelta(days=300),
        provider_name="Dr. Example",
        result_summary="Cleared after follow-up",
        result_data={"score": 42},
        notes="Discussed sleep",
    )
    db_session.add(record)
    await db_session.flush()
    return SimpleNamespace(org_id=org_id, officer_id=officer_id, record=record)


async def _list(db_session, caller):
    return await ep.list_records(
        user_id=None,
        prospect_id=None,
        screening_type=None,
        record_status=None,
        pagination=PaginationParams(skip=0, limit=100),
        db=db_session,
        current_user=caller,
    )


@pytest.mark.integration
class TestRecordReads:
    async def test_view_alone_reads_status_without_the_narrative(
        self, db_session, scene
    ):
        caller = _caller(scene.org_id, scene.officer_id, "medical_screening.view")

        (listed,) = await _list(db_session, caller)
        single = await ep.get_record(
            record_id=scene.record.id, db=db_session, current_user=caller
        )

        for response in (listed, single):
            for field in NARRATIVE_FIELDS:
                assert getattr(response, field) is None, field
            # Compliance status is still there.
            assert response.status == "passed"
            assert response.expiration_date == scene.record.expiration_date
            assert response.user_name == "Pat Member"

    @pytest.mark.parametrize(
        "grant", [VIEW_DETAILS, "medical_screening.manage", "medical_screening.*"]
    )
    async def test_view_details_or_manage_reads_the_narrative(
        self, db_session, scene, grant
    ):
        caller = _caller(
            scene.org_id, scene.officer_id, "medical_screening.view", grant
        )

        (listed,) = await _list(db_session, caller)
        single = await ep.get_record(
            record_id=scene.record.id, db=db_session, current_user=caller
        )

        for response in (listed, single):
            assert response.provider_name == "Dr. Example"
            assert response.result_summary == "Cleared after follow-up"
            assert response.result_data == {"score": 42}
            assert response.notes == "Discussed sleep"

    async def test_the_audit_says_whether_the_narrative_was_returned(
        self, db_session, scene
    ):
        caller = _caller(scene.org_id, scene.officer_id, "medical_screening.view")

        await ep.get_record(
            record_id=scene.record.id, db=db_session, current_user=caller
        )

        (event,) = (
            (
                await db_session.execute(
                    select(AuditLog).where(
                        AuditLog.user_id == scene.officer_id,
                        AuditLog.event_type == "medical_screening.record_viewed",
                    )
                )
            )
            .scalars()
            .all()
        )
        assert event.event_data["narrative_included"] is False

    async def test_redaction_never_writes_to_the_record(self, db_session, scene):
        caller = _caller(scene.org_id, scene.officer_id, "medical_screening.view")

        await _list(db_session, caller)
        await db_session.refresh(scene.record)

        assert scene.record.provider_name == "Dr. Example"
        assert scene.record.notes == "Discussed sleep"
