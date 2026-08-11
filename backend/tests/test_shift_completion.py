"""
Integration tests for the shift completion service.

Covers:
  - Report creation and retrieval
  - Trainee acknowledgement
  - Report review (approve, flag, redact fields)
  - Trainee stats aggregation
  - Officer report listing
  - Cross-org isolation
  - Batch crew workflow
  - Draft lifecycle (create → edit → submit, regression guard)
  - Shift-linked reports with crew validation
  - Update field whitelist enforcement
"""

import json
import uuid
from datetime import date, datetime, time, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import HTTPException
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.shift_completion_service import ShiftCompletionService

pytestmark = [pytest.mark.integration]


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
        org_id, officer_id, trainee_id = setup_training_org
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
        org_id, officer_id, trainee_id = setup_training_org
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
        org_id, officer_id, trainee_id = setup_training_org
        svc = ShiftCompletionService(db_session)

        for i in range(3):
            await svc.create_report(
                organization_id=uuid.UUID(org_id),
                officer_id=uuid.UUID(officer_id),
                trainee_id=trainee_id,
                shift_date=date.today() - timedelta(days=i),
                hours_on_shift=12.0,
            )

        reports = await svc.get_reports_for_trainee(uuid.UUID(org_id), trainee_id)
        assert len(reports) == 3

    @pytest.mark.asyncio
    async def test_get_reports_by_officer(self, db_session, setup_training_org):
        org_id, officer_id, trainee_id = setup_training_org
        svc = ShiftCompletionService(db_session)

        await svc.create_report(
            organization_id=uuid.UUID(org_id),
            officer_id=uuid.UUID(officer_id),
            trainee_id=trainee_id,
            shift_date=date.today(),
            hours_on_shift=12.0,
        )

        reports = await svc.get_reports_by_officer(uuid.UUID(org_id), officer_id)
        assert len(reports) >= 1


# ── Acknowledgement Tests ────────────────────────────────────────────


class TestAcknowledgement:

    @pytest.mark.asyncio
    async def test_trainee_acknowledges_report(self, db_session, setup_training_org):
        org_id, officer_id, trainee_id = setup_training_org
        svc = ShiftCompletionService(db_session)

        report = await svc.create_report(
            organization_id=uuid.UUID(org_id),
            officer_id=uuid.UUID(officer_id),
            trainee_id=trainee_id,
            shift_date=date.today(),
            hours_on_shift=12.0,
        )

        acked = await svc.acknowledge_report(
            report.id, trainee_id, uuid.UUID(org_id), trainee_comments="Looks good"
        )
        assert acked is not None
        assert acked.trainee_acknowledged is True
        assert acked.trainee_comments == "Looks good"
        assert acked.trainee_acknowledged_at is not None

    @pytest.mark.asyncio
    async def test_wrong_trainee_cannot_acknowledge(
        self, db_session, setup_training_org
    ):
        org_id, officer_id, trainee_id = setup_training_org
        svc = ShiftCompletionService(db_session)

        report = await svc.create_report(
            organization_id=uuid.UUID(org_id),
            officer_id=uuid.UUID(officer_id),
            trainee_id=trainee_id,
            shift_date=date.today(),
            hours_on_shift=12.0,
        )

        # Officer tries to acknowledge (wrong user)
        result = await svc.acknowledge_report(report.id, officer_id, uuid.UUID(org_id))
        assert result is None


# ── Review Tests ─────────────────────────────────────────────────────


class TestReportReview:

    @pytest.mark.asyncio
    async def test_approve_report(self, db_session, setup_training_org):
        org_id, officer_id, trainee_id = setup_training_org
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
            report.id,
            uuid.UUID(org_id),
            officer_id,
            review_status="approved",
            reviewer_notes="All good",
        )
        assert reviewed is not None
        assert reviewed.review_status == "approved"
        assert reviewed.reviewer_notes == "All good"

    @pytest.mark.asyncio
    async def test_flag_report(self, db_session, setup_training_org):
        org_id, officer_id, trainee_id = setup_training_org
        svc = ShiftCompletionService(db_session)

        report = await svc.create_report(
            organization_id=uuid.UUID(org_id),
            officer_id=uuid.UUID(officer_id),
            trainee_id=trainee_id,
            shift_date=date.today(),
            hours_on_shift=12.0,
        )

        reviewed = await svc.review_report(
            report.id,
            uuid.UUID(org_id),
            officer_id,
            review_status="flagged",
            reviewer_notes="Needs more detail",
        )
        assert reviewed.review_status == "flagged"

    @pytest.mark.asyncio
    async def test_redact_fields(self, db_session, setup_training_org):
        org_id, officer_id, trainee_id = setup_training_org
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
            report.id,
            uuid.UUID(org_id),
            officer_id,
            review_status="approved",
            redact_fields=["performance_rating", "officer_narrative"],
        )
        assert reviewed.performance_rating is None
        assert reviewed.officer_narrative is None

    @pytest.mark.asyncio
    async def test_review_wrong_org_returns_none(self, db_session, setup_training_org):
        org_id, officer_id, trainee_id = setup_training_org
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
            report.id,
            uuid.uuid4(),
            officer_id,
            review_status="approved",
        )
        assert result is None

    @pytest.mark.asyncio
    async def test_get_reports_by_status(self, db_session, setup_training_org):
        org_id, officer_id, trainee_id = setup_training_org
        svc = ShiftCompletionService(db_session)

        await svc.create_report(
            organization_id=uuid.UUID(org_id),
            officer_id=uuid.UUID(officer_id),
            trainee_id=trainee_id,
            shift_date=date.today(),
            hours_on_shift=12.0,
            review_status="pending_review",
        )

        pending = await svc.get_reports_by_status(uuid.UUID(org_id), "pending_review")
        assert len(pending) >= 1


# ── Stats Tests ──────────────────────────────────────────────────────


class TestTraineeStats:

    @pytest.mark.asyncio
    async def test_get_trainee_stats(self, db_session, setup_training_org):
        org_id, officer_id, trainee_id = setup_training_org
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
        org_id, officer_id, trainee_id = setup_training_org
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


# ── Cross-Org Isolation Tests ───────────────────────────────────────


@pytest.fixture
async def two_orgs(db_session: AsyncSession):
    """Create two separate organizations with officers and trainees."""
    org_a = _uid()
    org_b = _uid()
    officer_a = _uid()
    officer_b = _uid()
    trainee_a = _uid()
    trainee_b = _uid()

    for oid, slug in [(org_a, "org-a"), (org_b, "org-b")]:
        await db_session.execute(
            text(
                "INSERT INTO organizations (id, name, organization_type, slug, timezone) "
                "VALUES (:id, :name, :otype, :slug, :tz)"
            ),
            {
                "id": oid,
                "name": f"Dept {slug}",
                "otype": "fire_department",
                "slug": f"{slug}-{oid[:8]}",
                "tz": "America/New_York",
            },
        )
    for uid, org, uname, fn, ln in [
        (officer_a, org_a, "off_a", "Ann", "Smith"),
        (officer_b, org_b, "off_b", "Bob", "Clark"),
        (trainee_a, org_a, "tr_a", "Carl", "Dean"),
        (trainee_b, org_b, "tr_b", "Dana", "Evans"),
    ]:
        await db_session.execute(
            text(
                "INSERT INTO users (id, organization_id, username, first_name, "
                "last_name, email, password_hash, status) "
                "VALUES (:id, :org, :un, :fn, :ln, :em, :pw, 'active')"
            ),
            {
                "id": uid,
                "org": org,
                "un": uname,
                "fn": fn,
                "ln": ln,
                "em": f"{uname}@test.com",
                "pw": "hashed",
            },
        )
    await db_session.flush()
    return {
        "org_a": org_a,
        "org_b": org_b,
        "officer_a": officer_a,
        "officer_b": officer_b,
        "trainee_a": trainee_a,
        "trainee_b": trainee_b,
    }


class TestCrossOrgIsolation:

    async def test_review_report_wrong_org(self, db_session, two_orgs):
        d = two_orgs
        svc = ShiftCompletionService(db_session)

        report = await svc.create_report(
            organization_id=uuid.UUID(d["org_a"]),
            officer_id=uuid.UUID(d["officer_a"]),
            trainee_id=d["trainee_a"],
            shift_date=date.today(),
            hours_on_shift=12.0,
        )

        result = await svc.review_report(
            report.id,
            uuid.UUID(d["org_b"]),
            d["officer_b"],
            review_status="approved",
        )
        assert result is None

    async def test_acknowledge_report_wrong_org(self, db_session, two_orgs):
        d = two_orgs
        svc = ShiftCompletionService(db_session)

        report = await svc.create_report(
            organization_id=uuid.UUID(d["org_a"]),
            officer_id=uuid.UUID(d["officer_a"]),
            trainee_id=d["trainee_a"],
            shift_date=date.today(),
            hours_on_shift=12.0,
        )

        result = await svc.acknowledge_report(
            report.id,
            d["trainee_a"],
            uuid.UUID(d["org_b"]),
        )
        assert result is None

    async def test_update_report_wrong_org(self, db_session, two_orgs):
        d = two_orgs
        svc = ShiftCompletionService(db_session)

        report = await svc.create_report(
            organization_id=uuid.UUID(d["org_a"]),
            officer_id=uuid.UUID(d["officer_a"]),
            trainee_id=d["trainee_a"],
            shift_date=date.today(),
            hours_on_shift=12.0,
            review_status="draft",
        )

        # get_report is org-scoped, so a wrong-org update fails closed
        # by returning None rather than reaching the ValueError branch.
        result = await svc.update_report(
            report.id,
            uuid.UUID(d["org_b"]),
            d["officer_a"],
            {"hours_on_shift": 24.0},
        )
        assert result is None

    async def test_update_report_wrong_officer(self, db_session, two_orgs):
        d = two_orgs
        svc = ShiftCompletionService(db_session)

        report = await svc.create_report(
            organization_id=uuid.UUID(d["org_a"]),
            officer_id=uuid.UUID(d["officer_a"]),
            trainee_id=d["trainee_a"],
            shift_date=date.today(),
            hours_on_shift=12.0,
            review_status="draft",
        )

        with pytest.raises(ValueError, match="filing officer"):
            await svc.update_report(
                report.id,
                uuid.UUID(d["org_a"]),
                d["officer_b"],
                {"hours_on_shift": 24.0},
            )

    async def test_reports_scoped_to_org(self, db_session, two_orgs):
        d = two_orgs
        svc = ShiftCompletionService(db_session)

        await svc.create_report(
            organization_id=uuid.UUID(d["org_a"]),
            officer_id=uuid.UUID(d["officer_a"]),
            trainee_id=d["trainee_a"],
            shift_date=date.today(),
            hours_on_shift=12.0,
        )
        await svc.create_report(
            organization_id=uuid.UUID(d["org_b"]),
            officer_id=uuid.UUID(d["officer_b"]),
            trainee_id=d["trainee_b"],
            shift_date=date.today(),
            hours_on_shift=8.0,
        )

        reports_a = await svc.get_all_reports(uuid.UUID(d["org_a"]))
        reports_b = await svc.get_all_reports(uuid.UUID(d["org_b"]))
        assert all(r.organization_id == d["org_a"] for r in reports_a)
        assert all(r.organization_id == d["org_b"] for r in reports_b)


# ── Draft Lifecycle Tests ───────────────────────────────────────────


class TestDraftLifecycle:

    async def test_create_draft_and_submit(self, db_session, setup_training_org):
        org_id, officer_id, trainee_id = setup_training_org
        svc = ShiftCompletionService(db_session)

        report = await svc.create_report(
            organization_id=uuid.UUID(org_id),
            officer_id=uuid.UUID(officer_id),
            trainee_id=trainee_id,
            shift_date=date.today(),
            hours_on_shift=12.0,
            review_status="draft",
        )
        assert report.review_status == "draft"

        updated = await svc.update_report(
            report.id,
            uuid.UUID(org_id),
            officer_id,
            {
                "performance_rating": 4,
                "officer_narrative": "Good work",
                "review_status": "approved",
            },
        )
        assert updated is not None
        assert updated.review_status == "approved"
        assert updated.performance_rating == 4

    async def test_cannot_revert_to_draft(self, db_session, setup_training_org):
        org_id, officer_id, trainee_id = setup_training_org
        svc = ShiftCompletionService(db_session)

        report = await svc.create_report(
            organization_id=uuid.UUID(org_id),
            officer_id=uuid.UUID(officer_id),
            trainee_id=trainee_id,
            shift_date=date.today(),
            hours_on_shift=12.0,
        )
        assert report.review_status == "approved"

        with pytest.raises(ValueError, match="Cannot revert to draft"):
            await svc.update_report(
                report.id,
                uuid.UUID(org_id),
                officer_id,
                {"review_status": "draft"},
            )

    async def test_update_enrollment_id_on_draft(self, db_session, setup_training_org):
        org_id, officer_id, trainee_id = setup_training_org
        svc = ShiftCompletionService(db_session)

        report = await svc.create_report(
            organization_id=uuid.UUID(org_id),
            officer_id=uuid.UUID(officer_id),
            trainee_id=trainee_id,
            shift_date=date.today(),
            hours_on_shift=12.0,
            review_status="draft",
        )
        assert report.enrollment_id is None

        # enrollment_id FKs program_enrollments — persist a real enrollment
        from app.models.training import ProgramEnrollment, TrainingProgram

        program = TrainingProgram(
            id=_uid(), organization_id=org_id, name="Probationary Program"
        )
        db_session.add(program)
        await db_session.flush()
        enrollment = ProgramEnrollment(
            id=_uid(),
            organization_id=org_id,
            user_id=trainee_id,
            program_id=program.id,
        )
        db_session.add(enrollment)
        await db_session.flush()

        updated = await svc.update_report(
            report.id,
            uuid.UUID(org_id),
            officer_id,
            {"enrollment_id": enrollment.id},
        )
        assert updated is not None
        assert updated.enrollment_id == enrollment.id


# ── Update Whitelist Tests ──────────────────────────────────────────


class TestUpdateWhitelist:

    async def test_whitelisted_fields_apply(self, db_session, setup_training_org):
        org_id, officer_id, trainee_id = setup_training_org
        svc = ShiftCompletionService(db_session)

        report = await svc.create_report(
            organization_id=uuid.UUID(org_id),
            officer_id=uuid.UUID(officer_id),
            trainee_id=trainee_id,
            shift_date=date.today(),
            hours_on_shift=12.0,
            review_status="draft",
        )

        updated = await svc.update_report(
            report.id,
            uuid.UUID(org_id),
            officer_id,
            {
                "hours_on_shift": 24.0,
                "calls_responded": 5,
                "performance_rating": 3,
                "areas_of_strength": "Leadership",
                "officer_narrative": "Great shift",
            },
        )
        assert updated.hours_on_shift == 24.0
        assert updated.calls_responded == 5
        assert updated.performance_rating == 3

    async def test_blocked_fields_ignored(self, db_session, setup_training_org):
        org_id, officer_id, trainee_id = setup_training_org
        svc = ShiftCompletionService(db_session)

        report = await svc.create_report(
            organization_id=uuid.UUID(org_id),
            officer_id=uuid.UUID(officer_id),
            trainee_id=trainee_id,
            shift_date=date.today(),
            hours_on_shift=12.0,
            review_status="draft",
        )
        original_trainee = report.trainee_id
        original_officer = report.officer_id
        original_org = report.organization_id

        await svc.update_report(
            report.id,
            uuid.UUID(org_id),
            officer_id,
            {
                "trainee_id": _uid(),
                "officer_id": _uid(),
                "organization_id": _uid(),
                "id": _uid(),
                "reviewed_by": _uid(),
                "trainee_acknowledged": True,
            },
        )

        refreshed = await svc.get_report(report.id)
        assert refreshed.trainee_id == original_trainee
        assert refreshed.officer_id == original_officer
        assert refreshed.organization_id == original_org
        assert refreshed.trainee_acknowledged is False


# ── Batch Crew Workflow Tests ───────────────────────────────────────


@pytest.fixture
async def setup_shift_with_crew(db_session: AsyncSession):
    """Create org, shift, officer, and assigned crew members."""
    org_id = _uid()
    officer_id = _uid()
    crew_1 = _uid()
    crew_2 = _uid()
    shift_id = _uid()

    await db_session.execute(
        text(
            "INSERT INTO organizations (id, name, organization_type, slug, timezone) "
            "VALUES (:id, :name, :otype, :slug, :tz)"
        ),
        {
            "id": org_id,
            "name": "Batch Test FD",
            "otype": "fire_department",
            "slug": f"batch-{org_id[:8]}",
            "tz": "America/New_York",
        },
    )
    for uid, uname, fn, ln in [
        (officer_id, "batch_off", "Officer", "One"),
        (crew_1, "crew_1", "Crew", "Alpha"),
        (crew_2, "crew_2", "Crew", "Beta"),
    ]:
        await db_session.execute(
            text(
                "INSERT INTO users (id, organization_id, username, first_name, "
                "last_name, email, password_hash, status) "
                "VALUES (:id, :org, :un, :fn, :ln, :em, :pw, 'active')"
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

    today = date.today()
    await db_session.execute(
        text(
            "INSERT INTO shifts (id, organization_id, shift_date, start_time, "
            "shift_officer_id) VALUES (:id, :org, :sd, :st, :off)"
        ),
        {
            "id": shift_id,
            "org": org_id,
            "sd": str(today),
            # Bind a datetime object, not a hand-built ISO string: an offset
            # suffix ("+00:00") in a DATETIME literal is a MySQL 8.0.19+
            # extension that MariaDB rejects with error 1292, and the project
            # ships MariaDB for ARM (docker-compose.arm.yml). The driver
            # renders a datetime to the plain literal both engines accept.
            "st": datetime.combine(today, time(8, 0), tzinfo=timezone.utc),
            "off": officer_id,
        },
    )

    for uid, pos in [
        (officer_id, "officer"),
        (crew_1, "firefighter"),
        (crew_2, "ems"),
    ]:
        await db_session.execute(
            text(
                "INSERT INTO shift_assignments (id, organization_id, shift_id, "
                "user_id, position, assignment_status) "
                "VALUES (:id, :org, :sid, :uid, :pos, 'assigned')"
            ),
            {
                "id": _uid(),
                "org": org_id,
                "sid": shift_id,
                "uid": uid,
                "pos": pos,
            },
        )

    await db_session.flush()
    return {
        "org_id": org_id,
        "officer_id": officer_id,
        "crew_1": crew_1,
        "crew_2": crew_2,
        "shift_id": shift_id,
        "shift_date": today,
    }


class TestBatchCrewWorkflow:

    async def test_get_shift_crew_status(self, db_session, setup_shift_with_crew):
        d = setup_shift_with_crew
        svc = ShiftCompletionService(db_session)

        crew = await svc.get_shift_crew_status(uuid.UUID(d["org_id"]), d["shift_id"])
        assert len(crew) == 3
        user_ids = {m["user_id"] for m in crew}
        assert d["officer_id"] in user_ids
        assert d["crew_1"] in user_ids
        assert d["crew_2"] in user_ids
        assert all(not m["has_existing_report"] for m in crew)

    async def test_crew_status_wrong_org_returns_empty(
        self, db_session, setup_shift_with_crew
    ):
        d = setup_shift_with_crew
        svc = ShiftCompletionService(db_session)

        crew = await svc.get_shift_crew_status(uuid.uuid4(), d["shift_id"])
        assert crew == []

    async def test_crew_status_marks_reported_members(
        self, db_session, setup_shift_with_crew
    ):
        d = setup_shift_with_crew
        svc = ShiftCompletionService(db_session)

        await svc.create_report(
            organization_id=uuid.UUID(d["org_id"]),
            officer_id=uuid.UUID(d["officer_id"]),
            trainee_id=d["crew_1"],
            shift_date=d["shift_date"],
            hours_on_shift=12.0,
            shift_id=d["shift_id"],
        )

        crew = await svc.get_shift_crew_status(uuid.UUID(d["org_id"]), d["shift_id"])
        reported = {m["user_id"] for m in crew if m["has_existing_report"]}
        not_reported = {m["user_id"] for m in crew if not m["has_existing_report"]}
        assert d["crew_1"] in reported
        assert d["crew_2"] in not_reported

    async def test_batch_create_reports(self, db_session, setup_shift_with_crew):
        d = setup_shift_with_crew
        svc = ShiftCompletionService(db_session)

        result = await svc.batch_create_reports(
            organization_id=uuid.UUID(d["org_id"]),
            officer_id=uuid.UUID(d["officer_id"]),
            shift_id=d["shift_id"],
            shift_date=d["shift_date"],
            hours_on_shift=12.0,
            calls_responded=3,
            call_types=["medical"],
            officer_narrative="Routine shift",
            crew_member_ids=[d["crew_1"], d["crew_2"]],
            trainee_evaluations=None,
        )
        assert result["created"] == 2
        assert result["skipped"] == 0
        assert len(result["report_ids"]) == 2

    async def test_batch_skips_duplicate_reports(
        self, db_session, setup_shift_with_crew
    ):
        d = setup_shift_with_crew
        svc = ShiftCompletionService(db_session)

        await svc.create_report(
            organization_id=uuid.UUID(d["org_id"]),
            officer_id=uuid.UUID(d["officer_id"]),
            trainee_id=d["crew_1"],
            shift_date=d["shift_date"],
            hours_on_shift=12.0,
            shift_id=d["shift_id"],
        )

        result = await svc.batch_create_reports(
            organization_id=uuid.UUID(d["org_id"]),
            officer_id=uuid.UUID(d["officer_id"]),
            shift_id=d["shift_id"],
            shift_date=d["shift_date"],
            hours_on_shift=12.0,
            calls_responded=0,
            call_types=None,
            officer_narrative=None,
            crew_member_ids=[d["crew_1"], d["crew_2"]],
            trainee_evaluations=None,
        )
        assert result["created"] == 1
        assert result["skipped"] == 1


# ── Shift-Linked Validation Tests ───────────────────────────────────


class TestShiftLinkedValidation:

    async def test_report_date_must_match_shift(
        self, db_session, setup_shift_with_crew
    ):
        d = setup_shift_with_crew
        svc = ShiftCompletionService(db_session)

        with pytest.raises(ValueError, match="date does not match"):
            await svc.create_report(
                organization_id=uuid.UUID(d["org_id"]),
                officer_id=uuid.UUID(d["officer_id"]),
                trainee_id=d["crew_1"],
                shift_date=date.today() - timedelta(days=5),
                hours_on_shift=12.0,
                shift_id=d["shift_id"],
            )

    async def test_duplicate_report_for_same_shift_trainee(
        self, db_session, setup_shift_with_crew
    ):
        d = setup_shift_with_crew
        svc = ShiftCompletionService(db_session)

        await svc.create_report(
            organization_id=uuid.UUID(d["org_id"]),
            officer_id=uuid.UUID(d["officer_id"]),
            trainee_id=d["crew_1"],
            shift_date=d["shift_date"],
            hours_on_shift=12.0,
            shift_id=d["shift_id"],
        )

        with pytest.raises(ValueError, match="already exists"):
            await svc.create_report(
                organization_id=uuid.UUID(d["org_id"]),
                officer_id=uuid.UUID(d["officer_id"]),
                trainee_id=d["crew_1"],
                shift_date=d["shift_date"],
                hours_on_shift=12.0,
                shift_id=d["shift_id"],
            )

    async def test_shift_wrong_org_rejected(self, db_session, setup_shift_with_crew):
        d = setup_shift_with_crew
        svc = ShiftCompletionService(db_session)

        with pytest.raises(ValueError, match="Shift not found"):
            await svc.create_report(
                organization_id=uuid.uuid4(),
                officer_id=uuid.UUID(d["officer_id"]),
                trainee_id=d["crew_1"],
                shift_date=d["shift_date"],
                hours_on_shift=12.0,
                shift_id=d["shift_id"],
            )


# ── Preview / Shift Data Tests ──────────────────────────────────────


class TestShiftDataPreview:

    async def test_validate_shift_ownership(self, db_session, setup_shift_with_crew):
        d = setup_shift_with_crew
        svc = ShiftCompletionService(db_session)

        assert await svc.validate_shift_ownership(d["shift_id"], uuid.UUID(d["org_id"]))
        assert not await svc.validate_shift_ownership(d["shift_id"], uuid.uuid4())
        assert not await svc.validate_shift_ownership(_uid(), uuid.UUID(d["org_id"]))


class TestEquipmentCheckTrainingLink:
    def test_report_identity_supports_onboarding_apparatus(self):
        from app.models.apparatus import Apparatus
        from app.models.training import (
            BasicApparatus,
            Shift,
            ShiftCompletionReport,
        )

        apparatus = BasicApparatus(unit_number="E-1", name="Engine 1")
        shift = Shift()
        shift.basic_apparatus = apparatus
        report = ShiftCompletionReport()
        report.shift = shift

        assert report.apparatus_name == "E-1"

        shift.basic_apparatus = None
        shift.apparatus = Apparatus(unit_number="T-2", name="Old Reliable")
        assert report.apparatus_name == "T-2"

    async def test_trainee_checks_become_auditable_report_tasks(self):
        check = SimpleNamespace(
            id="check-1",
            check_timing="start_of_shift",
            overall_status="pass",
        )
        result = MagicMock()
        result.all.return_value = [(check, "Engine readiness")]
        db = MagicMock()
        db.execute = AsyncMock(return_value=result)

        tasks = await ShiftCompletionService(
            db
        )._get_trainee_equipment_checks_from_shift("shift-1", "trainee-1")

        assert tasks == [
            {
                "task": "Engine readiness",
                "description": "Start of shift equipment check — Pass",
                "equipment_check_id": "check-1",
            }
        ]


class TestTraineeReportReleaseBoundary:
    async def test_trainee_report_query_can_require_officer_release(self):
        scalar_result = MagicMock()
        scalar_result.all.return_value = []
        result = MagicMock()
        result.scalars.return_value = scalar_result
        db = MagicMock()
        db.execute = AsyncMock(return_value=result)

        await ShiftCompletionService(db).get_reports_for_trainee(
            organization_id=uuid.uuid4(),
            trainee_id="trainee-1",
            released_only=True,
        )

        query = db.execute.await_args.args[0]
        assert "approved" in query.compile().params.values()

    async def test_trainee_cannot_fetch_unreleased_report_by_id(self, monkeypatch):
        from app.api.v1.endpoints import shift_completion as endpoint

        report = SimpleNamespace(
            id="report-1",
            trainee_id="trainee-1",
            officer_id="officer-1",
            review_status="draft",
        )

        class FakeService:
            def __init__(self, _db):
                pass

            async def get_report(self, _report_id, _organization_id):
                return report

        monkeypatch.setattr(endpoint, "ShiftCompletionService", FakeService)
        user = SimpleNamespace(
            id="trainee-1",
            organization_id=uuid.uuid4(),
            positions=[],
            rank=None,
        )

        with pytest.raises(HTTPException) as exc:
            await endpoint.get_shift_report("report-1", MagicMock(), user)

        assert exc.value.status_code == 404

    async def test_unreleased_report_cannot_be_acknowledged(self):
        report = SimpleNamespace(
            trainee_id="trainee-1",
            organization_id=str(uuid.uuid4()),
            review_status="pending_review",
        )
        db = MagicMock()
        service = ShiftCompletionService(db)
        service.get_report = AsyncMock(return_value=report)

        acknowledged = await service.acknowledge_report(
            "report-1", "trainee-1", uuid.UUID(report.organization_id)
        )

        assert acknowledged is None
        db.commit.assert_not_called()


class TestTrainingCreditReleaseBoundary:
    async def test_pending_review_does_not_credit_until_approved(self):
        org_id = uuid.uuid4()
        report = SimpleNamespace(
            organization_id=str(org_id),
            officer_id="officer-1",
            review_status="draft",
        )
        db = MagicMock()
        db.commit = AsyncMock()
        db.refresh = AsyncMock()
        service = ShiftCompletionService(db)
        service.get_report = AsyncMock(return_value=report)
        service._trigger_deferred_progress = AsyncMock()

        await service.update_report(
            "report-1",
            org_id,
            "officer-1",
            {"review_status": "pending_review"},
        )
        service._trigger_deferred_progress.assert_not_awaited()

        await service.update_report(
            "report-1",
            org_id,
            "officer-1",
            {"review_status": "approved"},
        )
        service._trigger_deferred_progress.assert_awaited_once_with(report, "officer-1")


# ── Auto-population vs. the officer's own entry ──────────────────────


class TestCallCountAutoPopulation:
    """A linked shift fills the call count in; it does not overrule it.

    The report form's call-count field is editable and pre-filled from the same
    run log the service reads, so a value that arrives on the request is a
    correction — a run logged against the wrong crew, a member who rode in on
    one call and not another. Overwriting it answered 201 and stored the old
    number, which is indistinguishable from the edit having been saved.
    """

    async def _log_call(self, db_session, d, riders, incident_type):
        await db_session.execute(
            text(
                "INSERT INTO shift_calls (id, shift_id, organization_id, "
                "incident_type, responding_members) "
                "VALUES (:id, :sid, :org, :it, :rm)"
            ),
            {
                "id": _uid(),
                "sid": d["shift_id"],
                "org": d["org_id"],
                "it": incident_type,
                "rm": json.dumps(riders),
            },
        )
        await db_session.flush()

    async def test_derives_count_when_officer_supplies_none(
        self, db_session, setup_shift_with_crew
    ):
        d = setup_shift_with_crew
        await self._log_call(db_session, d, [d["crew_1"]], "EMS")
        await self._log_call(db_session, d, [d["crew_1"]], "Structure Fire")
        svc = ShiftCompletionService(db_session)

        report = await svc.create_report(
            organization_id=uuid.UUID(d["org_id"]),
            officer_id=uuid.UUID(d["officer_id"]),
            trainee_id=d["crew_1"],
            shift_date=d["shift_date"],
            hours_on_shift=12.0,
            shift_id=d["shift_id"],
            commit=False,
        )

        assert report.calls_responded == 2
        assert sorted(report.call_types) == ["EMS", "Structure Fire"]
        assert report.data_sources["calls_responded"] == "shift_calls"

    async def test_keeps_the_count_the_officer_typed(
        self, db_session, setup_shift_with_crew
    ):
        d = setup_shift_with_crew
        await self._log_call(db_session, d, [d["crew_1"]], "EMS")
        svc = ShiftCompletionService(db_session)

        report = await svc.create_report(
            organization_id=uuid.UUID(d["org_id"]),
            officer_id=uuid.UUID(d["officer_id"]),
            trainee_id=d["crew_1"],
            shift_date=d["shift_date"],
            hours_on_shift=12.0,
            calls_responded=3,
            shift_id=d["shift_id"],
            commit=False,
        )

        assert report.calls_responded == 3
        assert "calls_responded" not in report.data_sources

    async def test_an_explicit_zero_is_not_treated_as_absent(
        self, db_session, setup_shift_with_crew
    ):
        """The distinction the old `int = 0` default could not express."""
        d = setup_shift_with_crew
        await self._log_call(db_session, d, [d["crew_1"]], "EMS")
        svc = ShiftCompletionService(db_session)

        report = await svc.create_report(
            organization_id=uuid.UUID(d["org_id"]),
            officer_id=uuid.UUID(d["officer_id"]),
            trainee_id=d["crew_1"],
            shift_date=d["shift_date"],
            hours_on_shift=12.0,
            calls_responded=0,
            shift_id=d["shift_id"],
            commit=False,
        )

        assert report.calls_responded == 0

    async def test_batch_still_derives_per_trainee(
        self, db_session, setup_shift_with_crew
    ):
        """The batch form's count is per *shift*, so it must not fan out.

        crew_1 rode two calls and crew_2 one; handing both the shift-wide
        figure would credit crew_2 with a run they were not on.
        """
        d = setup_shift_with_crew
        await self._log_call(db_session, d, [d["crew_1"], d["crew_2"]], "EMS")
        await self._log_call(db_session, d, [d["crew_1"]], "Structure Fire")
        svc = ShiftCompletionService(db_session)

        result = await svc.batch_create_reports(
            organization_id=uuid.UUID(d["org_id"]),
            officer_id=uuid.UUID(d["officer_id"]),
            shift_id=d["shift_id"],
            shift_date=d["shift_date"],
            hours_on_shift=12.0,
            calls_responded=2,
            call_types=["EMS", "Structure Fire"],
            officer_narrative=None,
            crew_member_ids=[d["crew_1"], d["crew_2"]],
            trainee_evaluations=None,
        )

        by_trainee = {
            r.trainee_id: r
            for r in await svc.get_reports_by_officer(
                uuid.UUID(d["org_id"]), d["officer_id"]
            )
        }
        assert result["created"] == 2
        assert by_trainee[d["crew_1"]].calls_responded == 2
        assert by_trainee[d["crew_2"]].calls_responded == 1
