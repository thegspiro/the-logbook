"""A screening saved without an expiration date falls due by its frequency (W71-1).

Grading used to count a passed, completed or waived record with no
``expiration_date`` as compliant forever, and nothing read a requirement's
``frequency_months``: an annual physical recorded without an expiration never
lapsed, and "Every 12 months" on the requirement card described nothing.

Owner decision: such a record falls due ``frequency_months`` after its
completed date, using the frequency of the requirement the record is linked
to. A record's own expiration date still wins, and a record whose requirement
has no frequency stays compliant indefinitely. The expiring list applies the
same rule so the summary's count and the list agree.

Since 2026-11-04 a record counts only toward the requirement it is linked to
(owner decision 2026-11-01), so the "graded requirement" fallback for an
unlinked record is gone: an unlinked record counts toward nothing.
"""

import uuid
from datetime import date, timedelta
from types import SimpleNamespace

import pytest
from dateutil.relativedelta import relativedelta
from sqlalchemy import text

from app.models.medical_screening import (
    ScreeningRecord,
    ScreeningRequirement,
    ScreeningStatus,
    ScreeningType,
)
from app.services.medical_screening_service import (
    MedicalScreeningService,
    _effective_expiration,
)

pytestmark = [pytest.mark.integration]


def _uid() -> str:
    return str(uuid.uuid4())


@pytest.fixture
async def scene(db_session, setup_org_and_admin):
    org_id, _ = setup_org_and_admin
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
    return SimpleNamespace(org_id=org_id, member_id=member_id)


async def _requirement(
    db, org_id, months, active=True, kind=ScreeningType.PHYSICAL_EXAM, grace=0
):
    # No grace by default: these tests pin the frequency-derived due date
    # itself. The model's default of 30 days became live on 2026-11-04 (MS-16).
    req = ScreeningRequirement(
        id=_uid(),
        organization_id=org_id,
        name=f"Physical every {months} months",
        screening_type=kind,
        frequency_months=months,
        is_active=active,
        grace_period_days=grace,
    )
    db.add(req)
    await db.flush()
    return req


async def _record(
    db,
    scene,
    completed,
    requirement_id=None,
    expiration=None,
    kind=ScreeningType.PHYSICAL_EXAM,
):
    record = ScreeningRecord(
        id=_uid(),
        organization_id=scene.org_id,
        user_id=scene.member_id,
        requirement_id=requirement_id,
        screening_type=kind,
        status=ScreeningStatus.PASSED,
        completed_date=completed,
        expiration_date=expiration,
    )
    db.add(record)
    await db.flush()
    return record


async def _summary(db, scene):
    return await MedicalScreeningService(db).get_compliance_status(
        scene.org_id, user_id=scene.member_id
    )


class TestGrading:
    async def test_lapses_a_frequency_after_completion(self, db_session, scene):
        req = await _requirement(db_session, scene.org_id, 12)
        completed = date.today() - relativedelta(months=13)
        await _record(db_session, scene, completed, requirement_id=req.id)

        summary = await _summary(db_session, scene)

        item = summary.items[0]
        assert item.is_compliant is False
        assert item.expiration_date == completed + relativedelta(months=12)
        assert item.expiration_from_frequency is True

    async def test_a_linked_one_time_requirement_never_lapses(self, db_session, scene):
        one_time = await _requirement(db_session, scene.org_id, None)
        await _record(
            db_session,
            scene,
            date.today() - relativedelta(years=5),
            requirement_id=one_time.id,
        )

        summary = await _summary(db_session, scene)

        assert summary.items[0].is_compliant is True
        assert summary.items[0].expiration_date is None

    async def test_no_frequency_anywhere_stays_compliant(self, db_session, scene):
        req = await _requirement(db_session, scene.org_id, None)
        await _record(
            db_session,
            scene,
            date.today() - relativedelta(years=5),
            requirement_id=req.id,
        )

        summary = await _summary(db_session, scene)

        assert summary.items[0].is_compliant is True
        assert summary.items[0].expiration_from_frequency is False

    async def test_the_records_own_expiration_wins(self, db_session, scene):
        req = await _requirement(db_session, scene.org_id, 12)
        own = date.today() + timedelta(days=200)
        await _record(
            db_session,
            scene,
            date.today() - relativedelta(months=13),
            requirement_id=req.id,
            expiration=own,
        )

        summary = await _summary(db_session, scene)

        assert summary.items[0].is_compliant is True
        assert summary.items[0].expiration_date == own
        assert summary.items[0].expiration_from_frequency is False


class TestExpiringList:
    async def test_lists_what_the_count_counts(self, db_session, scene):
        req = await _requirement(db_session, scene.org_id, 12)
        completed = date.today() - relativedelta(months=12) + timedelta(days=10)
        record = await _record(db_session, scene, completed, requirement_id=req.id)
        # Another type with no requirement: nothing to derive a date from.
        await _record(
            db_session,
            scene,
            date.today() - relativedelta(years=3),
            kind=ScreeningType.DRUG_SCREENING,
        )
        service = MedicalScreeningService(db_session)

        listed = await service.get_expiring_soon(scene.org_id, days=30)
        summary = await _summary(db_session, scene)

        assert [(r.record_id, r.expiration_from_frequency) for r in listed] == [
            (record.id, True)
        ]
        assert listed[0].expiration_date == completed + relativedelta(months=12)
        assert summary.expiring_soon_count == 1

    async def test_an_already_lapsed_record_is_not_listed(self, db_session, scene):
        req = await _requirement(db_session, scene.org_id, 12)
        await _record(
            db_session,
            scene,
            date.today() - relativedelta(months=14),
            requirement_id=req.id,
        )

        listed = await MedicalScreeningService(db_session).get_expiring_soon(
            scene.org_id, days=30
        )

        assert listed == []


@pytest.mark.parametrize(
    ("completed", "months", "expected"),
    [
        (date(2026, 8, 31), 6, date(2027, 2, 28)),
        (date(2027, 8, 31), 6, date(2028, 2, 29)),
        (date(2026, 1, 15), 12, date(2027, 1, 15)),
    ],
)
def test_months_are_calendar_months_clamped_to_the_month_end(
    completed, months, expected
):
    record = SimpleNamespace(expiration_date=None, completed_date=completed)
    linked = SimpleNamespace(frequency_months=months)

    assert _effective_expiration(record, linked) == (expected, True)


@pytest.mark.parametrize("months", [0, -3, None])
def test_a_frequency_that_is_not_positive_derives_nothing(months):
    record = SimpleNamespace(expiration_date=None, completed_date=date(2026, 1, 1))

    assert _effective_expiration(record, SimpleNamespace(frequency_months=months)) == (
        None,
        False,
    )


class TestSupersededRecords:
    """A record a newer one of the same type replaces is not expiring.

    The count grades only the subject's latest record of each type; the list
    named every record in the window, so a renewed physical still showed as
    "expiring in 10 days" beside a count of zero (pitfall #29).
    """

    async def _pair(self, db, org_id, **subject):
        # Both filed against the org's one physical requirement: supersession
        # is per requirement (owner decision 2026-11-01).
        requirement_id = (
            await db.execute(
                text("SELECT id FROM screening_requirements WHERE organization_id=:o"),
                {"o": org_id},
            )
        ).scalar_one()
        old = ScreeningRecord(
            id=_uid(),
            organization_id=org_id,
            requirement_id=requirement_id,
            screening_type=ScreeningType.PHYSICAL_EXAM,
            status=ScreeningStatus.PASSED,
            completed_date=date.today() - relativedelta(months=12),
            expiration_date=date.today() + timedelta(days=10),
            **subject,
        )
        renewed = ScreeningRecord(
            id=_uid(),
            organization_id=org_id,
            requirement_id=requirement_id,
            screening_type=ScreeningType.PHYSICAL_EXAM,
            status=ScreeningStatus.PASSED,
            completed_date=date.today() - timedelta(days=5),
            expiration_date=date.today() + relativedelta(months=12),
            **subject,
        )
        db.add_all([old, renewed])
        await db.flush()
        return old

    async def test_a_renewed_members_old_record_is_not_listed(self, db_session, scene):
        await _requirement(db_session, scene.org_id, 12)
        await self._pair(db_session, scene.org_id, user_id=scene.member_id)

        listed = await MedicalScreeningService(db_session).get_expiring_soon(
            scene.org_id, days=30
        )
        summary = await _summary(db_session, scene)

        assert listed == []
        assert summary.expiring_soon_count == 0

    async def test_a_renewed_prospects_old_record_is_not_listed(
        self, db_session, scene
    ):
        prospect_id = _uid()
        await db_session.execute(
            text(
                "INSERT INTO prospective_members (id, organization_id, "
                "first_name, last_name, email) VALUES (:id, :org, 'Sam', "
                "'Applicant', :em)"
            ),
            {"id": prospect_id, "org": scene.org_id, "em": f"{prospect_id}@t.com"},
        )
        await _requirement(db_session, scene.org_id, 12)
        await self._pair(db_session, scene.org_id, prospect_id=prospect_id)

        listed = await MedicalScreeningService(db_session).get_expiring_soon(
            scene.org_id, days=30
        )

        assert listed == []

    async def test_another_subjects_newer_record_does_not_hide_this_one(
        self, db_session, scene
    ):
        other = _uid()
        await db_session.execute(
            text(
                "INSERT INTO users (id, organization_id, username, first_name, "
                "last_name, email, password_hash, status) VALUES (:id, :org, "
                ":un, 'Lee', 'Other', :em, 'x', 'active')"
            ),
            {
                "id": other,
                "org": scene.org_id,
                "un": f"o-{other[:8]}",
                "em": f"{other}@t.com",
            },
        )
        await _requirement(db_session, scene.org_id, 12)
        old = await self._pair(db_session, scene.org_id, user_id=scene.member_id)
        # Only the renewal is moved to the other member.
        await db_session.execute(
            text(
                "UPDATE screening_records SET user_id=:o WHERE user_id=:m AND id<>:old"
            ),
            {"o": other, "m": scene.member_id, "old": old.id},
        )

        listed = await MedicalScreeningService(db_session).get_expiring_soon(
            scene.org_id, days=30
        )

        assert [r.record_id for r in listed] == [old.id]
