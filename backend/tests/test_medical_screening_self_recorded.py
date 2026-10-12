"""MS-7: a screening its own subject recorded is allowed, but flagged.

A ``medical_screening.manage`` holder could record a passing result for
themself and it counted exactly like one entered by somebody else. Blocking it
outright would break the small department where one person logs everyone's
external results, their own included, so the owner chose "allow but flag":
``self_recorded`` marks a record whose status was last set by the member it is
about, and the compliance views carry the flag.

Integration: the flag is a stored column and the compliance views read it back
from the database.
"""

import uuid
from datetime import date, timedelta
from types import SimpleNamespace

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.endpoints import medical_screening as ep
from app.models.medical_screening import ScreeningRequirement, ScreeningType
from app.schemas.medical_screening import ScreeningRecordCreate, ScreeningRecordUpdate
from app.services.medical_screening_service import MedicalScreeningService

pytestmark = [pytest.mark.integration]


def _uid() -> str:
    return str(uuid.uuid4())


@pytest.fixture
async def people(db_session: AsyncSession, setup_org_and_admin):
    """Two screening managers, each also a line member."""
    org_id, officer_id = setup_org_and_admin
    colleague_id = _uid()
    await db_session.execute(
        text(
            "INSERT INTO users (id, organization_id, username, first_name, "
            "last_name, email, password_hash, status) "
            "VALUES (:id, :org, :un, 'Col', 'League', :em, 'x', 'active')"
        ),
        {
            "id": colleague_id,
            "org": org_id,
            "un": f"c-{colleague_id[:8]}",
            "em": f"c-{colleague_id[:8]}@test.com",
        },
    )
    db_session.add(
        ScreeningRequirement(
            id=_uid(),
            organization_id=org_id,
            name="Annual Physical",
            screening_type=ScreeningType.PHYSICAL_EXAM,
        )
    )
    await db_session.flush()
    return SimpleNamespace(
        org_id=org_id,
        officer=SimpleNamespace(id=officer_id, organization_id=org_id, username="o"),
        colleague=SimpleNamespace(
            id=colleague_id, organization_id=org_id, username="c"
        ),
    )


def _passed_physical(user_id: str, expires: date | None = None):
    return ScreeningRecordCreate(
        screening_type="physical_exam",
        status="passed",
        user_id=user_id,
        completed_date=date.today(),
        expiration_date=expires,
    )


async def _create(db, actor, data):
    return await ep.create_record(data=data, db=db, current_user=actor)


async def _update(db, actor, record_id, **fields):
    return await ep.update_record(
        record_id=record_id,
        data=ScreeningRecordUpdate(**fields),
        db=db,
        current_user=actor,
    )


class TestTheFlagFollowsWhoSetTheStatus:
    async def test_recording_your_own_result_is_allowed_and_flagged(
        self, db_session, people
    ):
        record = await _create(
            db_session, people.officer, _passed_physical(people.officer.id)
        )
        assert record.status == "passed"
        assert record.self_recorded is True

    async def test_recording_someone_elses_result_is_not_flagged(
        self, db_session, people
    ):
        record = await _create(
            db_session, people.colleague, _passed_physical(people.officer.id)
        )
        assert record.self_recorded is False

    async def test_clearing_your_own_record_flags_it(self, db_session, people):
        record = await _create(
            db_session,
            people.colleague,
            ScreeningRecordCreate(
                screening_type="physical_exam",
                status="scheduled",
                user_id=people.officer.id,
            ),
        )
        updated = await _update(db_session, people.officer, record.id, status="passed")
        assert updated.self_recorded is True

    async def test_a_colleague_saving_the_status_clears_the_flag(
        self, db_session, people
    ):
        record = await _create(
            db_session, people.officer, _passed_physical(people.officer.id)
        )
        updated = await _update(
            db_session, people.colleague, record.id, status="passed"
        )
        assert updated.self_recorded is False
        assert updated.reviewed_by == people.colleague.id

    async def test_an_edit_that_leaves_the_status_alone_keeps_the_flag(
        self, db_session, people
    ):
        record = await _create(
            db_session, people.officer, _passed_physical(people.officer.id)
        )
        updated = await _update(
            db_session, people.colleague, record.id, notes="typo fixed"
        )
        assert updated.self_recorded is True


class TestComplianceViewsShowIt:
    async def test_compliance_item_and_count(self, db_session, people):
        await _create(db_session, people.officer, _passed_physical(people.officer.id))
        summary = await MedicalScreeningService(db_session).get_compliance_status(
            people.org_id, user_id=people.officer.id
        )
        # It still counts — the decision was to flag, not to refuse.
        assert summary.is_fully_compliant is True
        assert summary.self_recorded_count == 1
        (item,) = summary.items
        assert item.self_recorded is True

    async def test_independently_recorded_reads_clean(self, db_session, people):
        await _create(db_session, people.colleague, _passed_physical(people.officer.id))
        summary = await MedicalScreeningService(db_session).get_compliance_status(
            people.org_id, user_id=people.officer.id
        )
        assert summary.self_recorded_count == 0
        assert summary.items[0].self_recorded is False

    async def test_expiring_list(self, db_session, people):
        soon = date.today() + timedelta(days=5)
        own = await _create(
            db_session, people.officer, _passed_physical(people.officer.id, soon)
        )
        other = await _create(
            db_session,
            people.officer,
            _passed_physical(people.colleague.id, soon),
        )
        expiring = await MedicalScreeningService(db_session).get_expiring_soon(
            people.org_id, days=30
        )
        flags = {e.record_id: e.self_recorded for e in expiring}
        assert flags == {own.id: True, other.id: False}
