"""
Integration tests for the shift completion service.

Covers:
  - Report creation and retrieval
  - Trainee acknowledgement
  - Report review (approve, flag, redact fields)
  - Trainee stats aggregation
  - Officer report listing
"""

import pytest
import uuid
from datetime import date, timedelta

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.shift_completion_service import ShiftCompletionService


# ── Helpers ──────────────────────────────────────────────────────────


def _uid() -> str:
    return str(uuid.uuid4())


@pytest.fixture
async def setup_training_org(db_session: AsyncSession):
    """Create org, officer, and trainee for shift completion tests."""
    org_id = _uid()
    officer_id = _uid()
    trainee_id = _uid()

    await db_session.execute(
        text(
            "INSERT INTO organizations (id, name, organization_type, slug, timezone) "
            "VALUES (:id, :name, :otype, :slug, :tz)"
        ),
        {
            "id": org_id,
            "name": "Test FD",
            "otype": "fire_department",
            "slug": f"test-{org_id[:8]}",
            "tz": "America/New_York",
        },
    )
    for uid, uname, fn, ln in [
        (officer_id, "captain1", "Mike", "Jones"),
        (trainee_id, "probie1", "Alex", "Lee"),
    ]:
        await db_session.execute(
            text(
                "INSERT INTO users (id, organization_id, username, first_name, last_name, "
                "email, password_hash, status) VALUES (:id, :org, :un, :fn, :ln, :em, :pw, 'active')"
            ),
            {
                "id": uid,
                "org": org_id,
                "un": uname,
                "fn": fn,
                "ln": ln,
                "em": f"{uname}@test.com",
                "pw": "hashed",
            },
        )
    await db_session.flush()
    return org_id, officer_id, trainee_id


# ── Report CRUD Tests ────────────────────────────────────────────────


class TestReportCreation:

    @pytest.mark.asyncio
    async def test_create_report(self, db_session, setup_training_org):
        org_id, officer_id, trainee_id = await setup_training_org
        svc = ShiftCompletionService(db_session)

        report = await svc.create_report(
            organization_id=uuid.UUID(org_id),
            officer_id=uuid.UUID(officer_id),
            trainee_id=trainee_id,
            shift_date=date.today(),
            hours_on_shift=12.0,
            calls_responded=3,
            call_types=["medical", "fire", "medical"],
            performance_rating=4,
            areas_of_strength="Good hose handling",
            areas_for_improvement="Radio communication",
        )
        assert report is not None
        assert report.hours_on_shift == 12.0
        assert report.calls_responded == 3

    @pytest.mark.asyncio
    async def test_get_report_by_id(self, db_session, setup_training_org):
        org_id, officer_id, trainee_id = await setup_training_org
        svc = ShiftCompletionService(db_session)

        report = await svc.create_report(
            organization_id=uuid.UUID(org_id),
            officer_id=uuid.UUID(officer_id),
            trainee_id=trainee_id,
            shift_date=date.today(),
            hours_on_shift=8.0,
        )

        fetched = await svc.get_report(report.id)
        assert fetched is not None
        assert fetched.id == report.id

    @pytest.mark.asyncio
    async def test_get_reports_for_trainee(self, db_session, setup_training_org):
        org_id, officer_id, trainee_id = await setup_training_org
        svc = ShiftCompletionService(db_session)

        for i in range(3):
            await svc.create_report(
                organization_id=uuid.UUID(org_id),
                officer_id=uuid.UUID(officer_id),
                trainee_id=trainee_id,
                shift_date=date.today() - timedelta(days=i),
                hours_on_shift=12.0,
            )

        reports = await svc.get_reports_for_trainee(
            uuid.UUID(org_id), trainee_id
        )
        assert len(reports) == 3

    @pytest.mark.asyncio
    async def test_get_reports_by_officer(self, db_session, setup_training_org):
        org_id, officer_id, trainee_id = await setup_training_org
        svc = ShiftCompletionService(db_session)

        await svc.create_report(
            organization_id=uuid.UUID(org_id),
            officer_id=uuid.UUID(officer_id),
            trainee_id=trainee_id,
            shift_date=date.today(),
            hours_on_shift=12.0,
        )

        reports = await svc.get_reports_by_officer(
            uuid.UUID(org_id), officer_id
        )
        assert len(reports) >= 1


# ── Acknowledgement Tests ────────────────────────────────────────────


class TestAcknowledgement:

    @pytest.mark.asyncio
    async def test_trainee_acknowledges_report(self, db_session, setup_training_org):
        org_id, officer_id, trainee_id = await setup_training_org
        svc = ShiftCompletionService(db_session)

        report = await svc.create_report(
            organization_id=uuid.UUID(org_id),
            officer_id=uuid.UUID(officer_id),
            trainee_id=trainee_id,
            shift_date=date.today(),
            hours_on_shift=12.0,
        )

        acked = await svc.acknowledge_report(
            report.id, trainee_id, trainee_comments="Looks good"
        )
        assert acked is not None
        assert acked.trainee_acknowledged is True
        assert acked.trainee_comments == "Looks good"
        assert acked.trainee_acknowledged_at is not None

    @pytest.mark.asyncio
    async def test_wrong_trainee_cannot_acknowledge(self, db_session, setup_training_org):
        org_id, officer_id, trainee_id = await setup_training_org
        svc = ShiftCompletionService(db_session)

        report = await svc.create_report(
            organization_id=uuid.UUID(org_id),
            officer_id=uuid.UUID(officer_id),
            trainee_id=trainee_id,
            shift_date=date.today(),
            hours_on_shift=12.0,
        )

        # Officer tries to acknowledge (wrong user)
        result = await svc.acknowledge_report(report.id, officer_id)
        assert result is None


# ── Review Tests ─────────────────────────────────────────────────────


class TestReportReview:

    @pytest.mark.asyncio
    async def test_approve_report(self, db_session, setup_training_org):
        org_id, officer_id, trainee_id = await setup_training_org
        svc = ShiftCompletionService(db_session)

        report = await svc.create_report(
            organization_id=uuid.UUID(org_id),
            officer_id=uuid.UUID(officer_id),
            trainee_id=trainee_id,
            shift_date=date.today(),
            hours_on_shift=12.0,
            review_status="pending_review",
        )

        reviewed = await svc.review_report(
            report.id, uuid.UUID(org_id), officer_id,
            review_status="approved",
            reviewer_notes="All good",
        )
        assert reviewed is not None
        assert reviewed.review_status == "approved"
        assert reviewed.reviewer_notes == "All good"

    @pytest.mark.asyncio
    async def test_flag_report(self, db_session, setup_training_org):
        org_id, officer_id, trainee_id = await setup_training_org
        svc = ShiftCompletionService(db_session)

        report = await svc.create_report(
            organization_id=uuid.UUID(org_id),
            officer_id=uuid.UUID(officer_id),
            trainee_id=trainee_id,
            shift_date=date.today(),
            hours_on_shift=12.0,
        )

        reviewed = await svc.review_report(
            report.id, uuid.UUID(org_id), officer_id,
            review_status="flagged",
            reviewer_notes="Needs more detail",
        )
        assert reviewed.review_status == "flagged"

    @pytest.mark.asyncio
    async def test_redact_fields(self, db_session, setup_training_org):
        org_id, officer_id, trainee_id = await setup_training_org
        svc = ShiftCompletionService(db_session)

        report = await svc.create_report(
            organization_id=uuid.UUID(org_id),
            officer_id=uuid.UUID(officer_id),
            trainee_id=trainee_id,
            shift_date=date.today(),
            hours_on_shift=12.0,
            performance_rating=3,
            officer_narrative="Detailed narrative here",
        )

        reviewed = await svc.review_report(
            report.id, uuid.UUID(org_id), officer_id,
            review_status="approved",
            redact_fields=["performance_rating", "officer_narrative"],
        )
        assert reviewed.performance_rating is None
        assert reviewed.officer_narrative is None

    @pytest.mark.asyncio
    async def test_review_wrong_org_returns_none(self, db_session, setup_training_org):
        org_id, officer_id, trainee_id = await setup_training_org
        svc = ShiftCompletionService(db_session)

        report = await svc.create_report(
            organization_id=uuid.UUID(org_id),
            officer_id=uuid.UUID(officer_id),
            trainee_id=trainee_id,
            shift_date=date.today(),
            hours_on_shift=12.0,
        )

        # Use a random org ID
        result = await svc.review_report(
            report.id, uuid.uuid4(), officer_id,
            review_status="approved",
        )
        assert result is None

    @pytest.mark.asyncio
    async def test_get_reports_by_status(self, db_session, setup_training_org):
        org_id, officer_id, trainee_id = await setup_training_org
        svc = ShiftCompletionService(db_session)

        await svc.create_report(
            organization_id=uuid.UUID(org_id),
            officer_id=uuid.UUID(officer_id),
            trainee_id=trainee_id,
            shift_date=date.today(),
            hours_on_shift=12.0,
            review_status="pending_review",
        )

        pending = await svc.get_reports_by_status(
            uuid.UUID(org_id), "pending_review"
        )
        assert len(pending) >= 1


# ── Stats Tests ──────────────────────────────────────────────────────


class TestTraineeStats:

    @pytest.mark.asyncio
    async def test_get_trainee_stats(self, db_session, setup_training_org):
        org_id, officer_id, trainee_id = await setup_training_org
        svc = ShiftCompletionService(db_session)

        for i in range(3):
            await svc.create_report(
                organization_id=uuid.UUID(org_id),
                officer_id=uuid.UUID(officer_id),
                trainee_id=trainee_id,
                shift_date=date.today() - timedelta(days=i),
                hours_on_shift=12.0,
                calls_responded=2,
                performance_rating=4,
            )

        stats = await svc.get_trainee_stats(uuid.UUID(org_id), trainee_id)
        assert stats["total_reports"] == 3
        assert stats["total_hours"] == 36.0
        assert stats["total_calls"] == 6
        assert stats["avg_rating"] == 4.0

    @pytest.mark.asyncio
    async def test_get_all_reports_with_filters(self, db_session, setup_training_org):
        org_id, officer_id, trainee_id = await setup_training_org
        svc = ShiftCompletionService(db_session)

        today = date.today()
        for i in range(5):
            await svc.create_report(
                organization_id=uuid.UUID(org_id),
                officer_id=uuid.UUID(officer_id),
                trainee_id=trainee_id,
                shift_date=today - timedelta(days=i),
                hours_on_shift=8.0,
            )

        # Filter by date range
        reports = await svc.get_all_reports(
            uuid.UUID(org_id),
            start_date=today - timedelta(days=2),
            end_date=today,
        )
        assert len(reports) == 3
