"""
The historical CSV import refuses a completed row that has no completion date.

Such a record showed in the member's history but counted toward no
requirement window and no month or year total. The parse step now flags the
row, so the preview counts it under Errors rather than as ready; the confirm
step refuses it (covered in test_training_import_enum_rows.py).
"""

import io
import uuid
from unittest.mock import AsyncMock

import pytest
from fastapi import UploadFile
from sqlalchemy import select

from app.api.v1.endpoints import training as training_endpoints
from app.api.v1.endpoints.training import parse_historical_import
from app.models.user import User, UserStatus

pytestmark = [pytest.mark.integration]


@pytest.fixture(autouse=True)
def _no_malware_scan(monkeypatch):
    monkeypatch.setattr(training_endpoints, "reject_if_malicious", AsyncMock())


async def _member(db_session, org_id) -> User:
    member = User(
        id=str(uuid.uuid4()),
        organization_id=org_id,
        username=f"m{uuid.uuid4().hex[:10]}",
        email=f"{uuid.uuid4().hex[:8]}@dept.test",
        first_name="Pat",
        last_name="Member",
        password_hash="x",
        status=UserStatus.ACTIVE,
    )
    db_session.add(member)
    await db_session.flush()
    return member


async def _officer(db_session, admin_id) -> User:
    result = await db_session.execute(select(User).where(User.id == admin_id))
    return result.scalar_one()


async def _parse(db_session, officer, text):
    upload = UploadFile(filename="history.csv", file=io.BytesIO(text.encode()))
    return await parse_historical_import(
        file=upload, match_by="email", db=db_session, current_user=officer
    )


class TestUndatedRows:
    async def test_a_blank_date_is_an_error_and_not_ready(
        self, db_session, setup_org_and_admin
    ):
        org_id, admin_id = setup_org_and_admin
        member = await _member(db_session, org_id)
        officer = await _officer(db_session, admin_id)

        result = await _parse(
            db_session,
            officer,
            "email,course_name,completion_date\n"
            f"{member.email},Hazmat Awareness,2019-05-01\n"
            f"{member.email},Ladder Operations,\n",
        )

        by_course = {r.course_name: r for r in result.rows}
        assert by_course["Hazmat Awareness"].errors == []
        assert by_course["Ladder Operations"].errors == ["Missing completion date"]
        assert result.valid_rows == 1
        assert "Row 2: Missing completion date" in result.parse_errors

    async def test_a_file_without_a_date_column_flags_every_row(
        self, db_session, setup_org_and_admin
    ):
        org_id, admin_id = setup_org_and_admin
        member = await _member(db_session, org_id)
        officer = await _officer(db_session, admin_id)

        result = await _parse(
            db_session,
            officer,
            f"email,course_name\n{member.email},Hazmat Awareness\n",
        )

        assert [r.errors for r in result.rows] == [["Missing completion date"]]
        assert result.valid_rows == 0

    async def test_an_unreadable_date_is_reported_once(
        self, db_session, setup_org_and_admin
    ):
        org_id, admin_id = setup_org_and_admin
        member = await _member(db_session, org_id)
        officer = await _officer(db_session, admin_id)

        result = await _parse(
            db_session,
            officer,
            "email,course_name,completion_date\n"
            f"{member.email},Hazmat Awareness,sometime in May\n",
        )

        assert result.rows[0].errors == ["Invalid date format: sometime in May"]
        assert result.valid_rows == 0
