"""MS-13: a screening record belongs to exactly one member or one prospect.

The Add Record dialog had no control for either id, so every record it created
was attached to nobody and counted toward no one's compliance. Owner decision:
add a member/prospect picker and require exactly one of the two. The schema
enforces the rule; ``GET /medical-screening/subjects`` feeds the picker.
"""

import uuid
from types import SimpleNamespace

import pytest
from pydantic import ValidationError
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.endpoints import medical_screening as ep
from app.schemas.medical_screening import ScreeningRecordCreate
from app.services.medical_screening_service import MedicalScreeningService


def _uid() -> str:
    return str(uuid.uuid4())


@pytest.mark.unit
class TestExactlyOneSubject:
    def test_neither_is_rejected(self):
        with pytest.raises(ValidationError, match="exactly one member"):
            ScreeningRecordCreate(screening_type="physical_exam")

    def test_both_is_rejected(self):
        with pytest.raises(ValidationError, match="exactly one member"):
            ScreeningRecordCreate(
                screening_type="physical_exam", user_id="u-1", prospect_id="p-1"
            )

    def test_blank_strings_count_as_absent(self):
        with pytest.raises(ValidationError, match="exactly one member"):
            ScreeningRecordCreate(
                screening_type="physical_exam", user_id="", prospect_id=""
            )

    def test_a_member_alone_is_accepted(self):
        data = ScreeningRecordCreate(screening_type="physical_exam", user_id="u-1")
        assert data.user_id == "u-1"
        assert data.prospect_id is None

    def test_a_prospect_alone_is_accepted(self):
        data = ScreeningRecordCreate(screening_type="physical_exam", prospect_id="p-1")
        assert data.prospect_id == "p-1"
        assert data.user_id is None


async def _add_user(db, org_id, first, last, status="active", deleted=False):
    uid = _uid()
    await db.execute(
        text(
            "INSERT INTO users (id, organization_id, username, first_name, "
            "last_name, email, password_hash, status, deleted_at) "
            "VALUES (:id, :org, :un, :fn, :ln, :em, 'x', :st, "
            + ("NOW()" if deleted else "NULL")
            + ")"
        ),
        {
            "id": uid,
            "org": org_id,
            "un": f"u-{uid[:8]}",
            "fn": first,
            "ln": last,
            "em": f"u-{uid[:8]}@test.com",
            "st": status,
        },
    )
    return uid


async def _add_prospect(db, org_id, first, last, status="active"):
    pid = _uid()
    await db.execute(
        text(
            "INSERT INTO prospective_members (id, organization_id, first_name, "
            "last_name, email, status) VALUES (:id, :org, :fn, :ln, :em, :st)"
        ),
        {
            "id": pid,
            "org": org_id,
            "fn": first,
            "ln": last,
            "em": f"p-{pid[:8]}@test.com",
            "st": status,
        },
    )
    return pid


@pytest.mark.integration
class TestSubjectPicker:
    async def test_lists_current_members_and_open_prospects(
        self, db_session: AsyncSession, setup_org_and_admin
    ):
        org_id, admin_id = setup_org_and_admin
        on_leave = await _add_user(db_session, org_id, "Lee", "Leave", "leave")
        suspended = await _add_user(db_session, org_id, "Sue", "Suspended", "suspended")
        await _add_user(db_session, org_id, "Rita", "Retired", "retired")
        await _add_user(db_session, org_id, "Dee", "Deleted", deleted=True)
        open_prospect = await _add_prospect(db_session, org_id, "Al", "Applicant")
        held = await _add_prospect(db_session, org_id, "Hal", "Held", "on_hold")
        await _add_prospect(db_session, org_id, "Wil", "Withdrawn", "withdrawn")

        other_org = _uid()
        await db_session.execute(
            text(
                "INSERT INTO organizations (id, name, organization_type, slug, "
                "timezone) VALUES (:id, 'Other', 'fire_department', :slug, 'UTC')"
            ),
            {"id": other_org, "slug": f"o-{other_org[:8]}"},
        )
        await _add_user(db_session, other_org, "Out", "Sider")
        await _add_prospect(db_session, other_org, "Far", "Away")
        await db_session.flush()

        subjects = await MedicalScreeningService(db_session).list_subjects(org_id)

        member_ids = {m.id for m in subjects.members}
        assert member_ids == {admin_id, on_leave, suspended}
        assert {p.id for p in subjects.prospects} == {open_prospect, held}
        names = {m.id: m.name for m in subjects.members}
        assert names[on_leave] == "Lee Leave"

    async def test_create_for_a_prospect_through_the_endpoint(
        self, db_session: AsyncSession, setup_org_and_admin
    ):
        org_id, admin_id = setup_org_and_admin
        prospect_id = await _add_prospect(db_session, org_id, "Al", "Applicant")
        await db_session.flush()
        officer = SimpleNamespace(id=admin_id, organization_id=org_id, username="a")

        record = await ep.create_record(
            data=ScreeningRecordCreate(
                screening_type="physical_exam",
                status="scheduled",
                prospect_id=prospect_id,
            ),
            db=db_session,
            current_user=officer,
        )

        assert record.prospect_id == prospect_id
        assert record.user_id is None
        assert record.prospect_name == "Al Applicant"
