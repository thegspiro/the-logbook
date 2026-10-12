"""
QUAL-1: qualifications entered directly, on the member profile and by CSV.

A qualification used to arrive only as a side effect of a training record, so a
licence a member held before the department adopted the system could be
recorded only by inventing a course completion. These cover the direct writer,
the CSV import's per-row validation, and — the point of the exercise — that
shift eligibility reads what they write.
"""

import uuid
from datetime import date, timedelta
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from sqlalchemy import select, text

from app.api.v1.endpoints import member_qualifications as endpoints
from app.models.qualification import MemberQualification
from app.services.qualification_import_service import QualificationImportService
from app.services.qualification_service import QualificationService
from app.services.shift_eligibility_service import ShiftEligibilityService

pytestmark = pytest.mark.integration


async def _add_member(db_session, org_id: str, membership_number: str) -> str:
    user_id = str(uuid.uuid4())
    await db_session.execute(
        text(
            "INSERT INTO users "
            "(id, organization_id, username, first_name, last_name, email, "
            "password_hash, status, membership_number) "
            "VALUES (:id, :org, :un, 'Pat', 'Medic', :em, 'x', 'active', :mn)"
        ),
        {
            "id": user_id,
            "org": org_id,
            "un": f"pm-{user_id[:8]}",
            "em": f"pm-{user_id[:8]}@test.com",
            "mn": membership_number,
        },
    )
    await db_session.flush()
    return user_id


async def _add_org(db_session) -> str:
    org_id = str(uuid.uuid4())
    await db_session.execute(
        text(
            "INSERT INTO organizations (id, name, organization_type, slug, timezone) "
            "VALUES (:id, 'Other Dept', 'fire_department', :slug, 'UTC')"
        ),
        {"id": org_id, "slug": f"other-{org_id[:8]}"},
    )
    await db_session.flush()
    return org_id


def _officer(org_id: str, user_id: str):
    return SimpleNamespace(
        id=user_id, organization_id=org_id, username="officer", permissions=[]
    )


class TestDirectEntry:
    async def test_an_entered_licence_clears_the_member_for_its_seats(
        self, db_session, setup_org_and_admin
    ):
        org_id, admin_id = setup_org_and_admin
        member_id = await _add_member(db_session, org_id, "M-100")

        rows = await endpoints.upsert_member_qualification(
            user_id=member_id,
            code="paramedic",
            payload=endpoints.MemberQualificationUpsert(
                granted_on=date(2016, 9, 15), expires_on=None, notes="State #42"
            ),
            db=db_session,
            current_user=_officer(org_id, admin_id),
        )

        assert [(r.qualification_code, r.source, r.in_force) for r in rows] == [
            ("paramedic", "manual", True)
        ]
        seats = await ShiftEligibilityService(db_session)._get_qualification_positions(
            member_id, org_id, date.today()
        )
        assert {"paramedic", "ems"} <= seats

    async def test_an_expired_entry_is_listed_but_clears_nothing(
        self, db_session, setup_org_and_admin
    ):
        org_id, admin_id = setup_org_and_admin
        member_id = await _add_member(db_session, org_id, "M-101")
        lapsed = date.today() - timedelta(days=1)

        rows = await endpoints.upsert_member_qualification(
            user_id=member_id,
            code="emt",
            payload=endpoints.MemberQualificationUpsert(expires_on=lapsed),
            db=db_session,
            current_user=_officer(org_id, admin_id),
        )

        assert rows[0].in_force is False
        seats = await ShiftEligibilityService(db_session)._get_qualification_positions(
            member_id, org_id, date.today()
        )
        assert "ems" not in seats

    async def test_editing_a_record_sourced_grant_makes_it_the_officers(
        self, db_session, setup_org_and_admin
    ):
        org_id, admin_id = setup_org_and_admin
        member_id = await _add_member(db_session, org_id, "M-102")
        await QualificationService(db_session).grant(
            member_id,
            org_id,
            "emt",
            notes=QualificationService.RECORD_SOURCED_NOTE,
        )

        rows = await endpoints.upsert_member_qualification(
            user_id=member_id,
            code="emt",
            payload=endpoints.MemberQualificationUpsert(
                expires_on=date(2030, 1, 1),
                notes=QualificationService.RECORD_SOURCED_NOTE,
            ),
            db=db_session,
            current_user=_officer(org_id, admin_id),
        )

        # The marker is what lets a record correction delete a grant; an
        # officer's entry must never carry it, even when submitted verbatim.
        assert rows[0].source == "manual"
        stored = (
            await db_session.execute(
                select(MemberQualification.notes).where(
                    MemberQualification.user_id == member_id
                )
            )
        ).scalar_one()
        assert stored != QualificationService.RECORD_SOURCED_NOTE

    async def test_an_unknown_code_is_rejected(self, db_session, setup_org_and_admin):
        org_id, admin_id = setup_org_and_admin
        member_id = await _add_member(db_session, org_id, "M-103")

        with pytest.raises(HTTPException) as exc:
            await endpoints.upsert_member_qualification(
                user_id=member_id,
                code="astronaut",
                payload=endpoints.MemberQualificationUpsert(),
                db=db_session,
                current_user=_officer(org_id, admin_id),
            )
        assert exc.value.status_code == 400

    async def test_another_departments_member_is_not_found(
        self, db_session, setup_org_and_admin
    ):
        org_id, admin_id = setup_org_and_admin
        other_org = await _add_org(db_session)
        outsider = await _add_member(db_session, other_org, "X-1")

        with pytest.raises(HTTPException) as exc:
            await endpoints.upsert_member_qualification(
                user_id=outsider,
                code="emt",
                payload=endpoints.MemberQualificationUpsert(),
                db=db_session,
                current_user=_officer(org_id, admin_id),
            )
        assert exc.value.status_code == 404
        assert (
            await QualificationService(db_session).list_for_member(outsider, other_org)
            == []
        )

    async def test_removal_withdraws_eligibility(self, db_session, setup_org_and_admin):
        org_id, admin_id = setup_org_and_admin
        member_id = await _add_member(db_session, org_id, "M-104")
        officer = _officer(org_id, admin_id)
        await endpoints.upsert_member_qualification(
            user_id=member_id,
            code="driver_operator",
            payload=endpoints.MemberQualificationUpsert(),
            db=db_session,
            current_user=officer,
        )

        rows = await endpoints.delete_member_qualification(
            user_id=member_id,
            code="driver_operator",
            db=db_session,
            current_user=officer,
        )

        assert rows == []
        seats = await ShiftEligibilityService(db_session)._get_qualification_positions(
            member_id, org_id, date.today()
        )
        assert "driver" not in seats


class TestCsvImport:
    async def test_each_bad_row_is_reported_and_nothing_written_on_a_dry_run(
        self, db_session, setup_org_and_admin
    ):
        org_id, _ = setup_org_and_admin
        member_id = await _add_member(db_session, org_id, "M-200")
        other_org = await _add_org(db_session)
        await _add_member(db_session, other_org, "OUT-1")
        csv_text = "\n".join(
            [
                "membership_number,qualification,granted_on,expires_on",
                "M-200,EMT,2019-05-01,2027-03-31",
                "OUT-1,emt,,",
                "M-200,astronaut,,",
                "M-200,paramedic,2019-13-01,",
                "M-200,driver_operator,2025-01-01,2024-01-01",
                "M-200,Emt,,",
                ",emt,,",
            ]
        )

        result = await QualificationImportService(db_session).import_csv(
            csv_text, org_id, dry_run=True
        )

        assert result.total_rows == 7
        assert [(r.row, r.user_id, r.qualification_code) for r in result.rows] == [
            (2, member_id, "emt")
        ]
        errors = {e.row: e.message for e in result.errors}
        assert set(errors) == {3, 4, 5, 6, 7, 8}
        assert "no member of this department" in errors[3]
        assert "unknown qualification" in errors[4]
        assert "not a date" in errors[5]
        assert "before the granted date" in errors[6]
        assert "duplicates line 2" in errors[7]
        assert "membership number or email" in errors[8]
        assert result.imported == 0
        assert (
            await QualificationService(db_session).list_for_member(member_id, org_id)
            == []
        )

    async def test_the_real_run_writes_rows_eligibility_reads(
        self, db_session, setup_org_and_admin
    ):
        org_id, _ = setup_org_and_admin
        member_id = await _add_member(db_session, org_id, "M-201")
        csv_text = (
            "email,qualification,granted_on,expires_on,notes\n"
            f"pm-{member_id[:8]}@test.com,Driver / Operator,03/15/2020,,County card\n"
        )

        result = await QualificationImportService(db_session).import_csv(
            csv_text, org_id, dry_run=False
        )

        assert result.imported == 1
        assert result.errors == []
        held = await QualificationService(db_session).list_for_member(member_id, org_id)
        assert [(q.qualification_code, q.granted_on, q.notes) for q in held] == [
            ("driver_operator", date(2020, 3, 15), "County card")
        ]
        seats = await ShiftEligibilityService(db_session)._get_qualification_positions(
            member_id, org_id, date.today()
        )
        assert "driver" in seats

    async def test_a_file_without_a_member_column_is_refused(
        self, db_session, setup_org_and_admin
    ):
        org_id, _ = setup_org_and_admin
        with pytest.raises(ValueError, match="membership_number"):
            await QualificationImportService(db_session).import_csv(
                "name,qualification\nPat,emt\n", org_id, dry_run=True
            )
