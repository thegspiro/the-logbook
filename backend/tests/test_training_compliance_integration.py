"""
Integration tests for Training compliance calculation with real database records.

Verifies that TrainingService methods correctly evaluate compliance status
when operating against actual database rows rather than mock objects.
"""

import uuid
from datetime import date, datetime, timedelta, timezone
from uuid import UUID

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.training_service import TrainingService

pytestmark = [pytest.mark.integration]


def _uid() -> str:
    return str(uuid.uuid4())


_NOW = datetime.now(timezone.utc)


@pytest.fixture
async def setup_org_and_user(db_session: AsyncSession):
    """Insert a minimal organization and user via raw SQL."""
    org_id = _uid()
    user_id = _uid()
    await db_session.execute(
        text(
            "INSERT INTO organizations "
            "(id, name, organization_type, slug, timezone) "
            "VALUES (:id, :name, :otype, :slug, :tz)"
        ),
        {
            "id": org_id,
            "name": "Test Dept",
            "otype": "fire_department",
            "slug": f"test-{org_id[:8]}",
            "tz": "UTC",
        },
    )
    await db_session.execute(
        text(
            "INSERT INTO users "
            "(id, organization_id, username, first_name, last_name, "
            "email, password_hash, status) "
            "VALUES (:id, :org, :un, :fn, :ln, :em, :pw, 'active')"
        ),
        {
            "id": user_id,
            "org": org_id,
            "un": f"jsmith-{user_id[:8]}",
            "fn": "John",
            "ln": "Smith",
            "em": f"jsmith-{user_id[:8]}@test.com",
            "pw": "hashed",
        },
    )
    await db_session.flush()
    return org_id, user_id


async def _insert_hours_requirement(
    db_session: AsyncSession,
    org_id: str,
    *,
    name: str = "Annual Training Hours",
    required_hours: float = 24.0,
    frequency: str = "annual",
    source: str = "department",
    due_date_type: str = "calendar_period",
    period_start_month: int = 1,
    period_start_day: int = 1,
    due_date: date | None = None,
    rolling_period_months: int | None = None,
) -> str:
    """Insert an HOURS-type training requirement and return its id."""
    req_id = _uid()
    await db_session.execute(
        text(
            "INSERT INTO training_requirements "
            "(id, organization_id, name, requirement_type, source, "
            "required_hours, frequency, due_date_type, due_date, "
            "rolling_period_months, period_start_month, period_start_day, "
            "applies_to_all, active, created_at, updated_at) "
            "VALUES (:id, :org_id, :name, :req_type, :source, "
            ":hours, :freq, :ddt, :due_date, :rpm, :psm, :psd, "
            "1, 1, :now, :now)"
        ),
        {
            "id": req_id,
            "org_id": org_id,
            "name": name,
            "req_type": "hours",
            "source": source,
            "hours": required_hours,
            "freq": frequency,
            "ddt": due_date_type,
            "due_date": due_date,
            "rpm": rolling_period_months,
            "psm": period_start_month,
            "psd": period_start_day,
            "now": _NOW,
        },
    )
    await db_session.flush()
    return req_id


async def _insert_cert_requirement(
    db_session: AsyncSession,
    org_id: str,
    *,
    name: str = "EMT Certification",
    frequency: str = "biannual",
    source: str = "national",
) -> str:
    """Insert a CERTIFICATION-type training requirement and return its id."""
    req_id = _uid()
    await db_session.execute(
        text(
            "INSERT INTO training_requirements "
            "(id, organization_id, name, requirement_type, source, "
            "frequency, due_date_type, "
            "applies_to_all, active, created_at, updated_at) "
            "VALUES (:id, :org_id, :name, :req_type, :source, "
            ":freq, :ddt, "
            "1, 1, :now, :now)"
        ),
        {
            "id": req_id,
            "org_id": org_id,
            "name": name,
            "req_type": "certification",
            "source": source,
            "freq": frequency,
            "ddt": "certification_period",
            "now": _NOW,
        },
    )
    await db_session.flush()
    return req_id


async def _insert_training_record(
    db_session: AsyncSession,
    org_id: str,
    user_id: str,
    *,
    course_name: str = "General Training",
    training_type: str = "continuing_education",
    completion_date: date,
    hours_completed: float = 0.0,
    status: str = "completed",
    expiration_date: date | None = None,
) -> str:
    """Insert a training record and return its id."""
    rec_id = _uid()
    await db_session.execute(
        text(
            "INSERT INTO training_records "
            "(id, organization_id, user_id, course_name, training_type, "
            "completion_date, expiration_date, hours_completed, status, "
            "created_at, updated_at) "
            "VALUES (:id, :org_id, :user_id, :name, :type, "
            ":comp_date, :exp_date, :hours, :status, "
            ":now, :now)"
        ),
        {
            "id": rec_id,
            "org_id": org_id,
            "user_id": user_id,
            "name": course_name,
            "type": training_type,
            "comp_date": completion_date,
            "exp_date": expiration_date,
            "hours": hours_completed,
            "status": status,
            "now": _NOW,
        },
    )
    await db_session.flush()
    return rec_id


# ============================================
# Hours-Based Requirement Compliance
# ============================================


class TestHoursRequirementCompliance:
    """Verify hours-based training requirement evaluation against real DB rows."""

    async def test_no_records_means_not_met(
        self, db_session: AsyncSession, setup_org_and_user
    ):
        """With zero training records the requirement should show 0 hours and not met."""
        org_id, user_id = setup_org_and_user
        req_id = await _insert_hours_requirement(
            db_session, org_id, required_hours=24.0
        )

        svc = TrainingService(db_session)
        progress = await svc.check_requirement_progress(
            UUID(user_id), UUID(req_id), UUID(org_id)
        )

        assert progress.completed_hours == 0
        assert progress.required_hours == 24.0
        assert progress.is_complete is False

    async def test_days_until_due_is_populated(
        self, db_session: AsyncSession, setup_org_and_user
    ):
        """RequirementProgress.days_until_due must actually be set.

        The field defaults to None on the schema, and none of
        check_requirement_progress's three RequirementProgress(...)
        construction sites set it — so every consumer, including the MCP
        get_member_requirements_progress tool (whose docstring promises
        "days until due, negative when overdue"), always received null
        regardless of the requirement's actual due date. Caught by Codex
        reviewing TR-17 pass 3.
        """
        org_id, user_id = setup_org_and_user
        due = date.today() + timedelta(days=10)
        req_id = await _insert_hours_requirement(
            db_session, org_id, required_hours=24.0, due_date=due
        )

        svc = TrainingService(db_session)
        progress = await svc.check_requirement_progress(
            UUID(user_id), UUID(req_id), UUID(org_id)
        )

        assert progress.due_date == due
        assert progress.days_until_due == 10

    async def test_days_until_due_is_negative_when_overdue(
        self, db_session: AsyncSession, setup_org_and_user
    ):
        """An already-passed due date must report a negative day count."""
        org_id, user_id = setup_org_and_user
        due = date.today() - timedelta(days=5)
        req_id = await _insert_hours_requirement(
            db_session, org_id, required_hours=24.0, due_date=due
        )

        svc = TrainingService(db_session)
        progress = await svc.check_requirement_progress(
            UUID(user_id), UUID(req_id), UUID(org_id)
        )

        assert progress.days_until_due == -5

    async def test_days_until_due_falls_back_to_the_period_window_end(
        self, db_session: AsyncSession, setup_org_and_user
    ):
        """A calendar-period requirement has no due_date of its own — the
        deadline is the end of its evaluation window. Codex caught the first
        draft of this fix computing days_until_due solely from
        requirement.due_date, which left it null for every annual/quarterly/
        monthly requirement (i.e. the common case) and fixed only the rare
        explicit-due-date one.
        """
        org_id, user_id = setup_org_and_user
        req_id = await _insert_hours_requirement(
            db_session,
            org_id,
            required_hours=24.0,
            due_date_type="calendar_period",
        )

        svc = TrainingService(db_session)
        progress = await svc.check_requirement_progress(
            UUID(user_id), UUID(req_id), UUID(org_id)
        )

        year_end = date(date.today().year, 12, 31)
        assert progress.due_date == year_end
        assert progress.days_until_due == (year_end - date.today()).days

    async def test_days_until_due_for_rolling_requirement_anchors_on_last_completion(
        self, db_session: AsyncSession, setup_org_and_user
    ):
        """A rolling requirement's deadline is the last completion plus its
        interval, not `today` — _get_date_window() always returns `today` as
        the rolling window's end (a trailing evaluation window, not a
        deadline), which the round-1 fallback misread as "due today" for
        every rolling requirement regardless of completion history. Caught
        by Codex reviewing this fix's own first draft.
        """
        org_id, user_id = setup_org_and_user
        req_id = await _insert_hours_requirement(
            db_session,
            org_id,
            required_hours=24.0,
            due_date_type="rolling",
            rolling_period_months=24,
        )
        completion = date.today() - timedelta(days=365)
        await _insert_training_record(
            db_session,
            org_id,
            user_id,
            hours_completed=24.0,
            completion_date=completion,
        )

        svc = TrainingService(db_session)
        progress = await svc.check_requirement_progress(
            UUID(user_id), UUID(req_id), UUID(org_id)
        )

        from dateutil.relativedelta import relativedelta

        expected_due = completion + relativedelta(months=24)
        assert progress.due_date == expected_due
        assert progress.days_until_due == (expected_due - date.today()).days

    async def test_days_until_due_for_rolling_requirement_with_no_completion_is_none(
        self, db_session: AsyncSession, setup_org_and_user
    ):
        """With no completion on file there is no anchor for a rolling
        deadline — must stay null rather than misreport `today`."""
        org_id, user_id = setup_org_and_user
        req_id = await _insert_hours_requirement(
            db_session,
            org_id,
            required_hours=24.0,
            due_date_type="rolling",
            rolling_period_months=24,
        )

        svc = TrainingService(db_session)
        progress = await svc.check_requirement_progress(
            UUID(user_id), UUID(req_id), UUID(org_id)
        )

        assert progress.due_date is None
        assert progress.days_until_due is None

    async def test_partial_hours_not_met(
        self, db_session: AsyncSession, setup_org_and_user
    ):
        """16 of 24 required hours should be reported as incomplete."""
        org_id, user_id = setup_org_and_user
        req_id = await _insert_hours_requirement(
            db_session, org_id, required_hours=24.0
        )

        await _insert_training_record(
            db_session,
            org_id,
            user_id,
            hours_completed=10.0,
            completion_date=date(date.today().year, 3, 15),
        )
        await _insert_training_record(
            db_session,
            org_id,
            user_id,
            hours_completed=6.0,
            completion_date=date(date.today().year, 5, 10),
        )

        svc = TrainingService(db_session)
        progress = await svc.check_requirement_progress(
            UUID(user_id), UUID(req_id), UUID(org_id)
        )

        assert progress.completed_hours == 16.0
        assert progress.required_hours == 24.0
        assert progress.is_complete is False
        assert progress.percentage_complete < 100.0

    async def test_full_hours_met(self, db_session: AsyncSession, setup_org_and_user):
        """30 hours against a 24-hour requirement should be marked complete."""
        org_id, user_id = setup_org_and_user
        req_id = await _insert_hours_requirement(
            db_session, org_id, required_hours=24.0
        )

        await _insert_training_record(
            db_session,
            org_id,
            user_id,
            hours_completed=18.0,
            completion_date=date(date.today().year, 2, 1),
        )
        await _insert_training_record(
            db_session,
            org_id,
            user_id,
            hours_completed=12.0,
            completion_date=date(date.today().year, 6, 1),
        )

        svc = TrainingService(db_session)
        progress = await svc.check_requirement_progress(
            UUID(user_id), UUID(req_id), UUID(org_id)
        )

        assert progress.completed_hours == 30.0
        assert progress.is_complete is True
        assert progress.percentage_complete == 100.0

    async def test_only_completed_records_count(
        self, db_session: AsyncSession, setup_org_and_user
    ):
        """Cancelled records must not contribute to completed hours."""
        org_id, user_id = setup_org_and_user
        req_id = await _insert_hours_requirement(
            db_session, org_id, required_hours=24.0
        )

        await _insert_training_record(
            db_session,
            org_id,
            user_id,
            hours_completed=20.0,
            status="completed",
            completion_date=date(date.today().year, 4, 1),
        )
        await _insert_training_record(
            db_session,
            org_id,
            user_id,
            hours_completed=10.0,
            status="cancelled",
            completion_date=date(date.today().year, 5, 1),
        )

        svc = TrainingService(db_session)
        progress = await svc.check_requirement_progress(
            UUID(user_id), UUID(req_id), UUID(org_id)
        )

        assert progress.completed_hours == 20.0
        assert progress.is_complete is False


# ============================================
# Certification Compliance
# ============================================


class TestCertificationCompliance:
    """Verify certification-based requirement evaluation against real DB rows."""

    async def test_valid_certification(
        self, db_session: AsyncSession, setup_org_and_user
    ):
        """A certification expiring in the future should be marked met."""
        org_id, user_id = setup_org_and_user
        req_id = await _insert_cert_requirement(
            db_session, org_id, name="EMT Certification"
        )

        future_exp = date.today() + timedelta(days=180)
        await _insert_training_record(
            db_session,
            org_id,
            user_id,
            course_name="EMT Certification",
            training_type="certification",
            hours_completed=0.0,
            completion_date=date.today() - timedelta(days=365),
            expiration_date=future_exp,
        )

        svc = TrainingService(db_session)
        progress = await svc.check_requirement_progress(
            UUID(user_id), UUID(req_id), UUID(org_id)
        )

        assert progress.is_complete is True

    async def test_expired_certification(
        self, db_session: AsyncSession, setup_org_and_user
    ):
        """A certification that already expired should be marked not met."""
        org_id, user_id = setup_org_and_user
        req_id = await _insert_cert_requirement(
            db_session, org_id, name="Paramedic Certification"
        )

        past_exp = date.today() - timedelta(days=30)
        await _insert_training_record(
            db_session,
            org_id,
            user_id,
            course_name="Paramedic Certification",
            training_type="certification",
            hours_completed=0.0,
            completion_date=date.today() - timedelta(days=730),
            expiration_date=past_exp,
        )

        svc = TrainingService(db_session)
        progress = await svc.check_requirement_progress(
            UUID(user_id), UUID(req_id), UUID(org_id)
        )

        assert progress.is_complete is False

    async def test_expiring_certifications_query(
        self, db_session: AsyncSession, setup_org_and_user
    ):
        """get_expiring_certifications should return only certs within the lookahead window."""
        org_id, user_id = setup_org_and_user

        exp_30 = date.today() + timedelta(days=30)
        await _insert_training_record(
            db_session,
            org_id,
            user_id,
            course_name="Hazmat Ops",
            training_type="certification",
            hours_completed=0.0,
            completion_date=date.today() - timedelta(days=300),
            expiration_date=exp_30,
        )

        exp_120 = date.today() + timedelta(days=120)
        await _insert_training_record(
            db_session,
            org_id,
            user_id,
            course_name="Rope Rescue Tech",
            training_type="certification",
            hours_completed=0.0,
            completion_date=date.today() - timedelta(days=200),
            expiration_date=exp_120,
        )

        svc = TrainingService(db_session)
        expiring = await svc.get_expiring_certifications(UUID(org_id), days_ahead=90)

        expiring_names = [r.course_name for r in expiring]
        assert "Hazmat Ops" in expiring_names
        assert "Rope Rescue Tech" not in expiring_names


# ============================================
# Multiple Requirements for One User
# ============================================


class TestMultipleRequirements:
    """Verify get_all_requirements_progress with a mix of requirement types."""

    async def test_all_requirements_progress(
        self, db_session: AsyncSession, setup_org_and_user
    ):
        """One met and one unmet requirement should yield mixed results."""
        org_id, user_id = setup_org_and_user

        hours_req_id = await _insert_hours_requirement(
            db_session, org_id, required_hours=10.0, name="Basic Hours"
        )

        cert_req_id = await _insert_cert_requirement(
            db_session, org_id, name="CPR Certification"
        )

        # Satisfy the hours requirement
        await _insert_training_record(
            db_session,
            org_id,
            user_id,
            course_name="Pump Ops Drill",
            hours_completed=12.0,
            completion_date=date(date.today().year, 2, 15),
        )

        # Do NOT add a matching certification record — cert is unmet

        svc = TrainingService(db_session)
        progress_list = await svc.get_all_requirements_progress(
            UUID(user_id), UUID(org_id)
        )

        progress_by_id = {str(p.requirement_id): p for p in progress_list}

        hours_progress = progress_by_id.get(hours_req_id)
        assert hours_progress is not None
        assert hours_progress.is_complete is True

        cert_progress = progress_by_id.get(cert_req_id)
        assert cert_progress is not None
        assert cert_progress.is_complete is False


# ============================================
# User Training Stats
# ============================================


class TestUserTrainingStats:
    """Verify get_user_training_stats aggregates across record types."""

    async def test_user_stats_with_records(
        self, db_session: AsyncSession, setup_org_and_user
    ):
        """Stats should reflect total hours, current-year hours, and cert counts."""
        org_id, user_id = setup_org_and_user
        current_year = date.today().year

        # Two completed records this year
        await _insert_training_record(
            db_session,
            org_id,
            user_id,
            course_name="Ladder Drills",
            training_type="continuing_education",
            hours_completed=8.0,
            completion_date=date(current_year, 1, 20),
        )
        await _insert_training_record(
            db_session,
            org_id,
            user_id,
            course_name="Hose Operations",
            training_type="continuing_education",
            hours_completed=4.0,
            completion_date=date(current_year, 3, 10),
        )

        # One record from a previous year
        await _insert_training_record(
            db_session,
            org_id,
            user_id,
            course_name="Old Refresher",
            training_type="continuing_education",
            hours_completed=6.0,
            completion_date=date(current_year - 1, 9, 5),
        )

        # A cancelled record that should not count
        await _insert_training_record(
            db_session,
            org_id,
            user_id,
            course_name="Cancelled Class",
            training_type="continuing_education",
            hours_completed=5.0,
            status="cancelled",
            completion_date=date(current_year, 2, 1),
        )

        svc = TrainingService(db_session)
        stats = await svc.get_user_training_stats(UUID(user_id), UUID(org_id))

        # Total hours = 8 + 4 + 6 = 18 (only completed records)
        assert stats.total_hours == 18.0
        # This year = 8 + 4 = 12
        assert stats.hours_this_year == 12.0
        # 3 completed records total
        assert stats.completed_courses == 3
