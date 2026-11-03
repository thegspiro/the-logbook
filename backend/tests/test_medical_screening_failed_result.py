"""A failed screening counts against the member (W71b-1, owner decision 2026-11-02).

Grading used to consider only passed, completed and waived records, so a
member who failed their physical last week but passed one eleven months ago
read **compliant** on the roster, in the per-member panel and on their own
dashboard, and the older pass was still listed as "expiring".

Owner decision: the most recent result of the type decides. A failed result
makes the requirement unmet until a later passed, completed or waived record
supersedes it. A record with no result yet (scheduled, pending review) or one
marked expired decides nothing, so it neither revokes nor grants. "Most recent"
is the existing ordering: latest completed date, an undated record lowest, the
newer-created winning a same-day tie.
"""

import uuid
from datetime import date, datetime, timedelta, timezone
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
from app.services.medical_screening_service import MedicalScreeningService

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
            "VALUES (:id, :org, :un, 'Jordan', 'Avery', :em, 'x', 'active')"
        ),
        {
            "id": member_id,
            "org": org_id,
            "un": f"m-{member_id[:8]}",
            "em": f"m-{member_id[:8]}@test.com",
        },
    )
    requirement = ScreeningRequirement(
        id=_uid(),
        organization_id=org_id,
        name="Annual Physical",
        screening_type=ScreeningType.PHYSICAL_EXAM,
        frequency_months=12,
        is_active=True,
    )
    db_session.add(requirement)
    await db_session.flush()
    return SimpleNamespace(
        org_id=org_id, member_id=member_id, requirement_id=requirement.id
    )


async def _record(db, scene, status, completed, expiration=None, created_at=None):
    record = ScreeningRecord(
        id=_uid(),
        organization_id=scene.org_id,
        user_id=scene.member_id,
        requirement_id=scene.requirement_id,
        screening_type=ScreeningType.PHYSICAL_EXAM,
        status=status,
        completed_date=completed,
        expiration_date=expiration,
    )
    if created_at is not None:
        record.created_at = created_at
    db.add(record)
    await db.flush()
    return record


async def _passed_last_winter(db, scene):
    """A pass still valid for another three weeks."""
    return await _record(
        db,
        scene,
        ScreeningStatus.PASSED,
        completed=date.today() - relativedelta(months=11),
        expiration=date.today() + timedelta(days=20),
    )


async def _item(db, scene):
    summary = await MedicalScreeningService(db).get_compliance_status(
        scene.org_id, user_id=scene.member_id
    )
    return summary, summary.items[0]


class TestGrading:
    async def test_a_newer_failure_makes_the_requirement_unmet(self, db_session, scene):
        await _passed_last_winter(db_session, scene)
        failed_on = date.today() - timedelta(days=8)
        await _record(db_session, scene, ScreeningStatus.FAILED, failed_on)

        summary, item = await _item(db_session, scene)

        assert item.is_compliant is False
        assert item.status == ScreeningStatus.FAILED.value
        assert item.last_screening_date == failed_on
        assert item.expiration_date is None
        assert item.days_until_expiration is None
        assert summary.is_fully_compliant is False
        assert summary.non_compliant_count == 1
        assert summary.expiring_soon_count == 0

    async def test_a_failure_carries_no_expiration_even_with_one_saved(
        self, db_session, scene
    ):
        # Rows saved before the record form stopped suggesting a date for a
        # failed result (W71b-7) can carry one; it must not read as a clearance.
        await _record(
            db_session,
            scene,
            ScreeningStatus.FAILED,
            date.today() - timedelta(days=8),
            expiration=date.today() + relativedelta(months=12),
        )

        _, item = await _item(db_session, scene)

        assert item.is_compliant is False
        assert item.expiration_date is None

    async def test_a_later_pass_clears_the_failure(self, db_session, scene):
        await _record(
            db_session,
            scene,
            ScreeningStatus.FAILED,
            date.today() - timedelta(days=30),
        )
        await _record(
            db_session,
            scene,
            ScreeningStatus.PASSED,
            date.today() - timedelta(days=2),
            expiration=date.today() + relativedelta(months=12),
        )

        _, item = await _item(db_session, scene)

        assert item.is_compliant is True
        assert item.status == ScreeningStatus.PASSED.value

    async def test_a_later_waiver_clears_the_failure(self, db_session, scene):
        await _record(
            db_session,
            scene,
            ScreeningStatus.FAILED,
            date.today() - timedelta(days=30),
        )
        await _record(
            db_session,
            scene,
            ScreeningStatus.WAIVED,
            date.today() - timedelta(days=2),
            expiration=date.today() + relativedelta(months=6),
        )

        _, item = await _item(db_session, scene)

        assert item.is_compliant is True
        assert item.status == ScreeningStatus.WAIVED.value

    @pytest.mark.parametrize(
        "status",
        [
            ScreeningStatus.SCHEDULED,
            ScreeningStatus.PENDING_REVIEW,
            ScreeningStatus.EXPIRED,
        ],
    )
    async def test_a_record_without_a_result_decides_nothing(
        self, db_session, scene, status
    ):
        await _passed_last_winter(db_session, scene)
        await _record(db_session, scene, status, date.today() - timedelta(days=3))

        _, item = await _item(db_session, scene)

        assert item.is_compliant is True
        assert item.status == ScreeningStatus.PASSED.value

    async def test_an_undated_failure_ranks_below_a_dated_pass(self, db_session, scene):
        # Nothing places an undated record after anything, the ordering every
        # caller already used; a failure with no date cannot revoke a pass.
        await _passed_last_winter(db_session, scene)
        await _record(db_session, scene, ScreeningStatus.FAILED, None)

        _, item = await _item(db_session, scene)

        assert item.is_compliant is True

    async def test_a_same_day_result_is_decided_by_the_one_entered_later(
        self, db_session, scene
    ):
        day = date.today() - timedelta(days=4)
        earlier = datetime.now(timezone.utc) - timedelta(hours=2)
        later = datetime.now(timezone.utc) - timedelta(hours=1)
        await _record(
            db_session,
            scene,
            ScreeningStatus.PASSED,
            day,
            expiration=day + relativedelta(months=12),
            created_at=earlier,
        )
        await _record(db_session, scene, ScreeningStatus.FAILED, day, created_at=later)

        _, item = await _item(db_session, scene)

        assert item.is_compliant is False


class TestOtherScreensAgree:
    async def test_the_roster_reads_not_compliant(self, db_session, scene):
        await _passed_last_winter(db_session, scene)
        await _record(
            db_session,
            scene,
            ScreeningStatus.FAILED,
            date.today() - timedelta(days=8),
        )

        roster = await MedicalScreeningService(db_session).get_compliance_roster(
            scene.org_id
        )

        row = next(r for r in roster.rows if r.subject_id == scene.member_id)
        assert row.standing == "not_compliant"
        assert row.expiring_soon_count == 0

    async def test_the_members_own_summary_counts_it_unmet(self, db_session, scene):
        await _passed_last_winter(db_session, scene)
        await _record(
            db_session,
            scene,
            ScreeningStatus.FAILED,
            date.today() - timedelta(days=8),
        )

        mine = await MedicalScreeningService(db_session).get_my_compliance_summary(
            scene.org_id, scene.member_id
        )

        assert mine.is_fully_compliant is False
        assert mine.non_compliant_count == 1
        assert mine.days_until_next_expiration is None

    async def test_the_superseded_pass_is_not_listed_as_expiring(
        self, db_session, scene
    ):
        await _passed_last_winter(db_session, scene)
        await _record(
            db_session,
            scene,
            ScreeningStatus.FAILED,
            date.today() - timedelta(days=8),
        )

        listed = await MedicalScreeningService(db_session).get_expiring_soon(
            scene.org_id, days=30
        )

        assert listed == []

    async def test_a_pass_after_the_failure_is_listed_again(self, db_session, scene):
        await _record(
            db_session,
            scene,
            ScreeningStatus.FAILED,
            date.today() - relativedelta(months=12),
        )
        renewed = await _record(
            db_session,
            scene,
            ScreeningStatus.PASSED,
            date.today() - relativedelta(months=11),
            expiration=date.today() + timedelta(days=20),
        )

        listed = await MedicalScreeningService(db_session).get_expiring_soon(
            scene.org_id, days=30
        )

        assert [r.record_id for r in listed] == [renewed.id]
