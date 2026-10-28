"""Leave-of-absence and training-waiver reasons are ciphertext in the database
and ordinary strings everywhere else."""

from datetime import date

import pytest
from sqlalchemy import text, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.training import TrainingWaiver, TrainingWaiverType
from app.models.user import LeaveType, MemberLeaveOfAbsence
from tests.test_user_pii_encryption import _org, _user

pytestmark = pytest.mark.integration

REASON = "Chemotherapy, three rounds; back in the spring"


async def _member(db: AsyncSession) -> tuple[str, str]:
    org_id = await _org(db)
    user = _user(org_id)
    db.add(user)
    await db.flush()
    return org_id, user.id


def _leave(org_id: str, user_id: str, reason) -> MemberLeaveOfAbsence:
    return MemberLeaveOfAbsence(
        organization_id=org_id,
        user_id=user_id,
        leave_type=LeaveType.LEAVE_OF_ABSENCE,
        reason=reason,
        start_date=date(2026, 11, 1),
    )


def _waiver(org_id: str, user_id: str, reason) -> TrainingWaiver:
    return TrainingWaiver(
        organization_id=org_id,
        user_id=user_id,
        waiver_type=TrainingWaiverType.MEDICAL,
        reason=reason,
        start_date=date(2026, 11, 1),
    )


async def _raw(db: AsyncSession, table: str, row_id: str):
    return (
        await db.execute(
            text(f"SELECT reason FROM {table} WHERE id = :id"), {"id": row_id}
        )
    ).scalar_one()


@pytest.mark.parametrize(
    ("table", "make"),
    [("member_leaves_of_absence", _leave), ("training_waivers", _waiver)],
)
class TestStoredAsCiphertext:
    async def test_the_reason_is_not_readable_in_the_table(
        self, db_session: AsyncSession, table, make
    ):
        org_id, user_id = await _member(db_session)
        row = make(org_id, user_id, REASON)
        db_session.add(row)
        await db_session.flush()

        raw = await _raw(db_session, table, row.id)

        assert raw.startswith("$gcm2$")
        assert "Chemotherapy" not in raw

    async def test_the_application_reads_the_original_text(
        self, db_session: AsyncSession, table, make
    ):
        org_id, user_id = await _member(db_session)
        row = make(org_id, user_id, REASON)
        db_session.add(row)
        await db_session.flush()
        row_id, model = row.id, type(row)
        db_session.expire(row)

        loaded = await db_session.get(model, row_id)

        assert loaded.reason == REASON

    async def test_no_reason_stays_null(self, db_session: AsyncSession, table, make):
        """Attendance and tier rules treat a NULL reason as 'none given'."""
        org_id, user_id = await _member(db_session)
        row = make(org_id, user_id, None)
        db_session.add(row)
        await db_session.flush()

        assert await _raw(db_session, table, row.id) is None

    async def test_clearing_the_reason_stores_null_not_ciphertext(
        self, db_session: AsyncSession, table, make
    ):
        org_id, user_id = await _member(db_session)
        row = make(org_id, user_id, REASON)
        db_session.add(row)
        await db_session.flush()

        row.reason = None
        await db_session.flush()

        assert await _raw(db_session, table, row.id) is None

    async def test_anonymising_a_member_clears_it_with_a_bulk_update(
        self, db_session: AsyncSession, table, make
    ):
        """member_anonymization_service blanks reasons with a Core UPDATE."""
        org_id, user_id = await _member(db_session)
        row = make(org_id, user_id, REASON)
        db_session.add(row)
        await db_session.flush()
        row_id, model = row.id, type(row)

        await db_session.execute(
            update(model).where(model.user_id == user_id).values(reason=None)
        )

        assert await _raw(db_session, table, row_id) is None

    async def test_a_bulk_update_to_new_text_is_encrypted_too(
        self, db_session: AsyncSession, table, make
    ):
        org_id, user_id = await _member(db_session)
        row = make(org_id, user_id, None)
        db_session.add(row)
        await db_session.flush()
        row_id, model = row.id, type(row)

        await db_session.execute(
            update(model).where(model.id == row_id).values(reason="Shoulder surgery")
        )

        raw = await _raw(db_session, table, row_id)
        assert raw.startswith("$gcm2$")
        assert "surgery" not in raw
