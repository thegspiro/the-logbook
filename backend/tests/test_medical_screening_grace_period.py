"""MS-16: a member is compliant during the requirement's grace period.

Owner decision 2026-11-01, "Enforce it": ``grace_period_days`` used to be
stored and read by nothing — a screening was non-compliant the day after it
fell due, whatever the requirement said. Now it counts until its due date plus
the grace period. While in grace it is shown as due: it counts toward
``expiring_soon`` (so the roster row reads "Expiring soon", never a new
standing), the item carries ``in_grace_period`` and ``grace_period_ends``, and
the expiring list names it with a negative ``days_until_expiration``.

One rule, ``screening_deadline``, behind the summary, the roster, the member's
own counts and the expiring list (pitfall #29).
"""

import uuid
from datetime import date, timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from dateutil.relativedelta import relativedelta
from sqlalchemy import text

from app.models.medical_screening import (
    ScreeningRecord,
    ScreeningRequirement,
    ScreeningStatus,
    ScreeningType,
)
from app.schemas.medical_screening import ScreeningSubject, ScreeningSubjects
from app.services.medical_screening_service import MedicalScreeningService

TODAY = date(2026, 11, 4)


def _requirement(grace, months=None):
    req = MagicMock(spec=ScreeningRequirement)
    req.id = str(uuid.uuid4())
    req.name = "Annual Physical"
    req.screening_type = ScreeningType.PHYSICAL_EXAM
    req.frequency_months = months
    req.applies_to_roles = None
    req.grace_period_days = grace
    return req


def _record(req, *, due=None, completed=None, user_id="u-1"):
    rec = MagicMock(spec=ScreeningRecord)
    rec.id = str(uuid.uuid4())
    rec.requirement_id = req.id
    rec.screening_type = ScreeningType.PHYSICAL_EXAM
    rec.status = ScreeningStatus.PASSED.value
    rec.completed_date = completed or TODAY - timedelta(days=400)
    rec.expiration_date = due
    rec.user_id = user_id
    rec.prospect_id = None
    rec.self_recorded = False
    rec.created_at = None
    return rec


@pytest.fixture
def service(monkeypatch):
    monkeypatch.setattr(
        "app.services.medical_screening_service.resolve_org_today",
        AsyncMock(return_value=TODAY),
    )
    service = MedicalScreeningService(AsyncMock())
    with patch.object(
        service,
        "_resolve_names",
        return_value={"users": {}, "prospects": {}, "requirements": {}},
    ):
        yield service


async def _summary(service, req, records):
    with (
        patch.object(service, "list_requirements", return_value=[req]),
        patch.object(service, "list_records", return_value=records),
    ):
        return await service.get_compliance_status("org-1", user_id="u-1")


@pytest.mark.unit
class TestGrading:
    async def test_past_due_inside_the_grace_period_is_compliant(self, service):
        req = _requirement(grace=30)
        due = TODAY - timedelta(days=10)

        summary = await _summary(service, req, [_record(req, due=due)])

        (item,) = summary.items
        assert item.is_compliant is True
        assert item.in_grace_period is True
        assert item.grace_period_ends == due + timedelta(days=30)
        assert item.days_until_expiration == -10
        assert summary.is_fully_compliant is True
        # Shown as due: it lapses within the grace period.
        assert summary.expiring_soon_count == 1

    async def test_the_last_day_of_grace_still_counts(self, service):
        req = _requirement(grace=30)

        summary = await _summary(
            service, req, [_record(req, due=TODAY - timedelta(days=30))]
        )

        assert summary.items[0].is_compliant is True
        assert summary.items[0].grace_period_ends == TODAY

    async def test_past_the_grace_period_is_not_compliant(self, service):
        req = _requirement(grace=30)

        summary = await _summary(
            service, req, [_record(req, due=TODAY - timedelta(days=31))]
        )

        (item,) = summary.items
        assert item.is_compliant is False
        assert item.in_grace_period is False
        assert item.grace_period_ends is None
        assert summary.expiring_soon_count == 0

    async def test_no_grace_lapses_the_day_after_it_falls_due(self, service):
        req = _requirement(grace=0)

        summary = await _summary(
            service, req, [_record(req, due=TODAY - timedelta(days=1))]
        )

        assert summary.items[0].is_compliant is False

    async def test_a_frequency_derived_due_date_gets_the_grace_too(self, service):
        req = _requirement(grace=14, months=12)
        completed = TODAY - relativedelta(months=12) - timedelta(days=5)

        summary = await _summary(service, req, [_record(req, completed=completed)])

        (item,) = summary.items
        assert item.expiration_from_frequency is True
        assert item.in_grace_period is True
        assert item.is_compliant is True

    async def test_not_yet_due_is_not_in_grace(self, service):
        req = _requirement(grace=30)

        summary = await _summary(
            service, req, [_record(req, due=TODAY + timedelta(days=100))]
        )

        assert summary.items[0].in_grace_period is False
        assert summary.items[0].grace_period_ends is None

    async def test_the_members_own_countdown_reads_zero_not_negative(self, service):
        req = _requirement(grace=30)
        with (
            patch.object(service, "list_requirements", return_value=[req]),
            patch.object(
                service,
                "list_records",
                return_value=[_record(req, due=TODAY - timedelta(days=5))],
            ),
        ):
            mine = await service.get_my_compliance_summary("org-1", user_id="u-1")

        assert mine.is_fully_compliant is True
        assert mine.days_until_next_expiration == 0
        assert mine.expiring_soon_count == 1

    async def test_the_roster_reads_a_member_in_grace_as_expiring_soon(self, service):
        req = _requirement(grace=30)
        subjects = ScreeningSubjects(
            members=[ScreeningSubject(id="u-1", name="Ann Able")], prospects=[]
        )
        with (
            patch.object(service, "list_requirements", return_value=[req]),
            patch.object(service, "list_subjects", return_value=subjects),
            patch.object(
                service,
                "list_records",
                return_value=[_record(req, due=TODAY - timedelta(days=5))],
            ),
        ):
            roster = await service.get_compliance_roster("org-1")

        (row,) = roster.rows
        assert row.standing == "expiring_soon"
        assert (roster.compliant, roster.expiring_soon, roster.not_compliant) == (
            0,
            1,
            0,
        )


@pytest.fixture
async def scene(db_session, setup_org_and_admin):
    org_id, _ = setup_org_and_admin
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
    requirement = ScreeningRequirement(
        id=str(uuid.uuid4()),
        organization_id=org_id,
        name="Annual Physical",
        screening_type=ScreeningType.PHYSICAL_EXAM,
        frequency_months=12,
        grace_period_days=30,
    )
    db_session.add(requirement)
    await db_session.flush()
    return SimpleNamespace(org_id=org_id, member_id=member_id, requirement=requirement)


async def _add(db_session, scene, **fields):
    record = ScreeningRecord(
        id=str(uuid.uuid4()),
        organization_id=scene.org_id,
        user_id=scene.member_id,
        requirement_id=scene.requirement.id,
        screening_type=ScreeningType.PHYSICAL_EXAM,
        status=ScreeningStatus.PASSED,
        **fields,
    )
    db_session.add(record)
    await db_session.flush()
    return record


@pytest.mark.integration
class TestExpiringList:
    async def test_lists_a_screening_in_its_grace_period(self, db_session, scene):
        due = date.today() - timedelta(days=10)
        record = await _add(
            db_session,
            scene,
            completed_date=due - relativedelta(months=12),
            expiration_date=due,
        )
        service = MedicalScreeningService(db_session)

        listed = await service.get_expiring_soon(scene.org_id, days=30)
        summary = await service.get_compliance_status(
            scene.org_id, user_id=scene.member_id
        )

        (row,) = listed
        assert row.record_id == record.id
        assert row.days_until_expiration == -10
        assert row.in_grace_period is True
        assert row.grace_period_ends == due + timedelta(days=30)
        # The count and the list agree (pitfall #29).
        assert summary.expiring_soon_count == 1

    async def test_lists_one_falling_due_by_frequency_in_grace(self, db_session, scene):
        completed = date.today() - relativedelta(months=12) - timedelta(days=4)
        record = await _add(db_session, scene, completed_date=completed)

        (row,) = await MedicalScreeningService(db_session).get_expiring_soon(
            scene.org_id, days=30
        )

        assert row.record_id == record.id
        assert row.expiration_from_frequency is True
        assert row.in_grace_period is True

    async def test_one_past_its_grace_period_is_not_listed(self, db_session, scene):
        due = date.today() - timedelta(days=31)
        await _add(
            db_session,
            scene,
            completed_date=due - relativedelta(months=12),
            expiration_date=due,
        )
        service = MedicalScreeningService(db_session)

        assert await service.get_expiring_soon(scene.org_id, days=30) == []
        summary = await service.get_compliance_status(
            scene.org_id, user_id=scene.member_id
        )
        assert summary.non_compliant_count == 1
