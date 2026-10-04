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
    async def test_report_identity_supports_onboarding_apparatus(self):
        """The shift label resolves through basic_apparatus when the shift's
        apparatus_id references an onboarding-era row rather than a full
        Apparatus record — _attach_shift_labels retries unclaimed ids there."""
        from app.models.training import ShiftCompletionReport

        report = ShiftCompletionReport()
        report.shift_id = "shift-1"

        shifts_result = MagicMock()
        shifts_result.__iter__ = lambda self: iter(
            [SimpleNamespace(id="shift-1", apparatus_id="ba-1", start_time=None)]
        )
        no_full_apparatus = MagicMock()
        no_full_apparatus.__iter__ = lambda self: iter([])
        basic_result = MagicMock()
        basic_result.__iter__ = lambda self: iter(
            [SimpleNamespace(id="ba-1", unit_number="E-1", name="Engine 1")]
        )
        db = MagicMock()
        db.execute = AsyncMock(
            side_effect=[shifts_result, no_full_apparatus, basic_result]
        )

        [labeled] = await ShiftCompletionService(db)._attach_shift_labels(
            [report], uuid.uuid4()
        )

        assert labeled.shift_label == "E-1 — Engine 1"

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
            start_date=date.today(),
            end_date=date.today(),
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
    async def test_creation_only_credits_approved_reports(
        self, db_session, setup_training_org
    ):
        org_id, officer_id, trainee_id = setup_training_org
        service = ShiftCompletionService(db_session)
        service._create_skill_checkoffs = AsyncMock(return_value=[])
        service._update_requirement_progress = AsyncMock(return_value=[])

        await service.create_report(
            organization_id=uuid.UUID(org_id),
            officer_id=uuid.UUID(officer_id),
            trainee_id=trainee_id,
            shift_date=date.today(),
            hours_on_shift=12.0,
            review_status="pending_review",
        )

        service._create_skill_checkoffs.assert_not_awaited()
        service._update_requirement_progress.assert_not_awaited()

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

    async def test_reviewer_releases_credit_under_filing_officer(self):
        org_id = uuid.uuid4()
        report = SimpleNamespace(
            organization_id=str(org_id),
            officer_id="filing-officer",
            trainee_id="trainee-1",
            shift_date=date.today(),
            review_status="pending_review",
            review_history=[],
        )
        db = MagicMock()
        db.commit = AsyncMock()
        db.refresh = AsyncMock()
        service = ShiftCompletionService(db)
        service.get_report = AsyncMock(return_value=report)
        service._trigger_deferred_progress = AsyncMock()
        service._send_notification = AsyncMock()

        await service.review_report("report-1", org_id, "approving-officer", "approved")

        service._trigger_deferred_progress.assert_awaited_once_with(
            report, "filing-officer"
        )


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
        # Provenance decides whether anything may relabel these later. This
        # shift logged per-incident rows, so the strings are the officer's own
        # wording and must be shown as written.
        assert report.data_sources["call_types"] == "shift_calls"

    async def test_count_only_types_are_marked_as_org_slugs(
        self, db_session, setup_shift_with_crew
    ):
        """No ShiftCall rows, so the types come from the shift's own tally and
        are this org's slugs — the one shape that resolves to labels."""
        from app.core.utils import generate_uuid
        from app.models.call_tracking import OrgCall, OrgCallResponse

        d = setup_shift_with_crew
        call_id = generate_uuid()
        db_session.add(
            OrgCall(
                id=call_id,
                organization_id=d["org_id"],
                call_date=d["shift_date"],
                call_type="mutual_aid",
            )
        )
        db_session.add(
            OrgCallResponse(
                id=generate_uuid(),
                organization_id=d["org_id"],
                call_id=call_id,
                shift_id=d["shift_id"],
            )
        )
        # The officer's per-member credit, which is where a count-only
        # department's member figure comes from.
        await db_session.execute(
            text(
                "INSERT INTO shift_attendance "
                "(id, shift_id, user_id, duration_minutes, call_count) "
                "VALUES (:id, :sid, :uid, 720, 1)"
            ),
            {"id": generate_uuid(), "sid": d["shift_id"], "uid": d["crew_1"]},
        )
        await db_session.flush()

        report = await ShiftCompletionService(db_session).create_report(
            organization_id=uuid.UUID(d["org_id"]),
            officer_id=uuid.UUID(d["officer_id"]),
            trainee_id=d["crew_1"],
            shift_date=d["shift_date"],
            hours_on_shift=12.0,
            shift_id=d["shift_id"],
            commit=False,
        )

        assert report.call_types == ["mutual_aid"]
        assert report.data_sources["call_types"] == "org_calls"

    async def _count_only_report(self, db_session, d, slugs=("mutual_aid",)):
        """A linked-shift report whose types are this org's slugs."""
        from app.core.utils import generate_uuid
        from app.models.call_tracking import OrgCall, OrgCallResponse

        for slug in slugs:
            call_id = generate_uuid()
            db_session.add(
                OrgCall(
                    id=call_id,
                    organization_id=d["org_id"],
                    call_date=d["shift_date"],
                    call_type=slug,
                )
            )
            db_session.add(
                OrgCallResponse(
                    id=generate_uuid(),
                    organization_id=d["org_id"],
                    call_id=call_id,
                    shift_id=d["shift_id"],
                )
            )
        await db_session.execute(
            text(
                "INSERT INTO shift_attendance "
                "(id, shift_id, user_id, duration_minutes, call_count) "
                "VALUES (:id, :sid, :uid, 720, :n)"
            ),
            {
                "id": generate_uuid(),
                "sid": d["shift_id"],
                "uid": d["crew_1"],
                "n": len(slugs),
            },
        )
        await db_session.flush()

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
        await db_session.flush()
        assert report.data_sources["call_types"] == "org_calls"
        return svc, report

    async def test_an_edit_that_stays_in_slugs_keeps_its_provenance(
        self, db_session, setup_shift_with_crew
    ):
        """The draft editor offers this department's own types on a report that
        carries slugs, so an edit there yields slugs again. Clearing the marker
        would cost the report its labels and its standing as a reason not to
        delete a type, for an edit that changed neither."""
        d = setup_shift_with_crew
        svc, report = await self._count_only_report(db_session, d)

        updated = await svc.update_report(
            report_id=report.id,
            organization_id=uuid.UUID(d["org_id"]),
            officer_id=str(d["officer_id"]),
            updates={"call_types": ["mutual_aid", "fire"]},
        )

        assert updated is not None
        assert updated.call_types == ["mutual_aid", "fire"]
        assert (updated.data_sources or {}).get("call_types") == "org_calls"

    async def test_one_typed_name_among_the_slugs_clears_it(
        self, db_session, setup_shift_with_crew
    ):
        """The marker describes the array, and a reader relabels every value in
        it. A mixed list cannot claim they are all slugs."""
        d = setup_shift_with_crew
        svc, report = await self._count_only_report(db_session, d)

        updated = await svc.update_report(
            report_id=report.id,
            organization_id=uuid.UUID(d["org_id"]),
            officer_id=str(d["officer_id"]),
            updates={"call_types": ["mutual_aid", "Structure Fire"]},
        )

        assert updated is not None
        assert "call_types" not in (updated.data_sources or {})

    async def test_emptying_the_list_clears_it(self, db_session, setup_shift_with_crew):
        """A list with nothing in it describes no value at all."""
        d = setup_shift_with_crew
        svc, report = await self._count_only_report(db_session, d)

        updated = await svc.update_report(
            report_id=report.id,
            organization_id=uuid.UUID(d["org_id"]),
            officer_id=str(d["officer_id"]),
            updates={"call_types": []},
        )

        assert updated is not None
        assert "call_types" not in (updated.data_sources or {})

    async def test_a_slug_no_longer_configured_clears_it(
        self, db_session, setup_shift_with_crew
    ):
        """Only types in force can be confirmed. A value the department no
        longer configures resolves to no label, so the marker buys the report
        nothing and asserting it would be a claim nothing supports."""
        d = setup_shift_with_crew
        svc, report = await self._count_only_report(db_session, d)

        updated = await svc.update_report(
            report_id=report.id,
            organization_id=uuid.UUID(d["org_id"]),
            officer_id=str(d["officer_id"]),
            updates={"call_types": ["retired_long_ago"]},
        )

        assert updated is not None
        assert "call_types" not in (updated.data_sources or {})

    async def test_a_detailed_reports_marker_still_clears_on_any_edit(
        self, db_session, setup_shift_with_crew
    ):
        """A detailed-tracking report's values are the officer's own wording,
        and an edit that happens to name a configured type does not make them
        the department's slug list. Its marker clears as it always has —
        preserving provenance is scoped to the one case it describes."""
        d = setup_shift_with_crew
        await self._log_call(db_session, d, [d["crew_1"]], "EMS")
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
        await db_session.flush()
        assert report.data_sources["call_types"] == "shift_calls"

        updated = await svc.update_report(
            report_id=report.id,
            organization_id=uuid.UUID(d["org_id"]),
            officer_id=str(d["officer_id"]),
            updates={"call_types": ["fire"]},
        )

        assert updated is not None
        assert "call_types" not in (updated.data_sources or {})

    async def test_editing_a_draft_s_types_clears_their_provenance(
        self, db_session, setup_shift_with_crew
    ):
        """An officer editing the auto-filled list types readable names, not
        slugs. Leaving the marker would let a later rename rewrite what they
        wrote, and let it lock a type from deletion."""
        d = setup_shift_with_crew
        await self._log_call(db_session, d, [d["crew_1"]], "EMS")
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
        await db_session.flush()
        assert report.data_sources["call_types"] == "shift_calls"

        updated = await svc.update_report(
            report_id=report.id,
            organization_id=uuid.UUID(d["org_id"]),
            officer_id=str(d["officer_id"]),
            updates={"call_types": ["Structure Fire"]},
        )

        assert updated is not None
        assert updated.call_types == ["Structure Fire"]
        assert "call_types" not in (updated.data_sources or {})
        # Untouched provenance for other fields survives.
        assert (updated.data_sources or {}).get("calls_responded") == "shift_calls"

    async def test_resubmitting_the_same_types_keeps_their_provenance(
        self, db_session, setup_shift_with_crew
    ):
        """The report form resubmits `call_types` whatever was edited, so
        clearing on presence alone dropped the marker when an officer saved a
        narrative tweak — and those values are still the slugs it describes."""
        d = setup_shift_with_crew
        await self._log_call(db_session, d, [d["crew_1"]], "EMS")
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
        await db_session.flush()
        original = list(report.call_types)

        updated = await svc.update_report(
            report_id=report.id,
            organization_id=uuid.UUID(d["org_id"]),
            officer_id=str(d["officer_id"]),
            updates={"call_types": original, "officer_narrative": "Quiet tour."},
        )

        assert updated is not None
        assert (updated.data_sources or {}).get("call_types") == "shift_calls"

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


class TestNoSelfReports:
    """A member never files a shift report about themselves."""

    async def test_single_report_about_yourself_is_refused(
        self, db_session, setup_shift_with_crew
    ):
        d = setup_shift_with_crew
        svc = ShiftCompletionService(db_session)
        with pytest.raises(ValueError, match="about yourself"):
            await svc.create_report(
                organization_id=uuid.UUID(d["org_id"]),
                officer_id=uuid.UUID(d["officer_id"]),
                trainee_id=d["officer_id"],
                shift_date=d["shift_date"],
                hours_on_shift=12.0,
                shift_id=d["shift_id"],
            )

    async def test_batch_skips_the_author_and_files_the_rest(
        self, db_session, setup_shift_with_crew
    ):
        d = setup_shift_with_crew
        svc = ShiftCompletionService(db_session)
        result = await svc.batch_create_reports(
            organization_id=uuid.UUID(d["org_id"]),
            officer_id=uuid.UUID(d["officer_id"]),
            shift_id=d["shift_id"],
            shift_date=d["shift_date"],
            hours_on_shift=12.0,
            calls_responded=0,
            call_types=None,
            officer_narrative=None,
            crew_member_ids=[d["officer_id"], d["crew_1"]],
            trainee_evaluations=None,
        )
        assert result["created"] == 1
        assert result["skipped"] == 1
        trainees = (
            (
                await db_session.execute(
                    text(
                        "SELECT trainee_id FROM shift_completion_reports "
                        "WHERE shift_id = :sid"
                    ),
                    {"sid": d["shift_id"]},
                )
            )
            .scalars()
            .all()
        )
        assert trainees == [d["crew_1"]]

    async def _draft_for_training_slot(self, db_session, d, finalized_by):
        from app.services.scheduling_service import SchedulingService

        await db_session.execute(
            text(
                "UPDATE shift_assignments SET is_training = 1 "
                "WHERE shift_id = :sid AND user_id = :uid"
            ),
            {"sid": d["shift_id"], "uid": d["crew_1"]},
        )
        await db_session.flush()
        shift = SimpleNamespace(
            id=d["shift_id"],
            shift_date=d["shift_date"],
            start_time=None,
            end_time=None,
        )
        return await SchedulingService(db_session)._create_draft_reports_for_trainees(
            shift=shift,
            organization_id=uuid.UUID(d["org_id"]),
            finalized_by_user_id=finalized_by,
        )

    async def test_finalize_drafts_a_report_for_someone_elses_trainee_slot(
        self, db_session, setup_shift_with_crew
    ):
        d = setup_shift_with_crew
        assert await self._draft_for_training_slot(db_session, d, d["officer_id"]) == 1

    async def test_finalize_skips_a_trainee_who_closed_out_their_own_shift(
        self, db_session, setup_shift_with_crew
    ):
        # With no evaluator named on the slot the draft would be attributed to
        # the finalizer — the trainee themselves.
        d = setup_shift_with_crew
        assert await self._draft_for_training_slot(db_session, d, d["crew_1"]) == 0


class TestOfficerAnalyticsScope:
    """ "Written by me" covers the caller's reports; department covers all."""

    async def _file(self, svc, d, officer_id, trainee_id, shift_date, hours):
        await svc.create_report(
            organization_id=uuid.UUID(d["org_id"]),
            officer_id=uuid.UUID(officer_id),
            trainee_id=trainee_id,
            shift_date=shift_date,
            hours_on_shift=hours,
        )

    async def test_scoped_to_the_officer_who_filed(
        self, db_session, setup_shift_with_crew
    ):
        d = setup_shift_with_crew
        svc = ShiftCompletionService(db_session)
        today = date.today()
        await self._file(svc, d, d["officer_id"], d["crew_1"], today, 12.0)
        # crew_1 files one about crew_2: someone else's report.
        await self._file(svc, d, d["crew_1"], d["crew_2"], today, 6.0)

        mine = await svc.get_officer_analytics(
            uuid.UUID(d["org_id"]), officer_id=d["officer_id"]
        )
        department = await svc.get_officer_analytics(uuid.UUID(d["org_id"]))

        assert mine["total_reports"] == 1
        assert mine["total_hours"] == 12.0
        assert [t["trainee_id"] for t in mine["trainees"]] == [d["crew_1"]]
        assert department["total_reports"] == 2
        assert department["total_hours"] == 18.0

    async def test_monthly_trend_keeps_the_latest_six_months(
        self, db_session, setup_shift_with_crew
    ):
        d = setup_shift_with_crew
        svc = ShiftCompletionService(db_session)
        first = date.today().replace(day=1)
        for back in range(8):
            month = first
            for _ in range(back):
                month = (month - timedelta(days=1)).replace(day=1)
            await self._file(svc, d, d["officer_id"], d["crew_1"], month, 1.0)

        months = [
            m["month"]
            for m in (await svc.get_officer_analytics(uuid.UUID(d["org_id"])))[
                "monthly"
            ]
        ]
        assert len(months) == 6
        assert months == sorted(months)
        # Ascending-then-LIMIT kept the oldest six and dropped this month.
        assert months[-1] == first.strftime("%Y-%m")


class TestPerMemberCalls:
    """The crew list previews each member's calls; the batch stores them, or
    the officer's correction."""

    async def _log_calls(self, db_session, d, responders_per_call):
        from app.models.training import ShiftCall

        for responders in responders_per_call:
            db_session.add(
                ShiftCall(
                    shift_id=d["shift_id"],
                    organization_id=d["org_id"],
                    incident_type="medical",
                    responding_members=responders,
                )
            )
        await db_session.flush()

    async def test_crew_status_previews_each_members_derived_calls(
        self, db_session, setup_shift_with_crew
    ):
        d = setup_shift_with_crew
        await self._log_calls(
            db_session, d, [[d["crew_1"], d["crew_2"]], [d["crew_1"]]]
        )
        svc = ShiftCompletionService(db_session)
        crew = {
            m["user_id"]: m
            for m in await svc.get_shift_crew_status(
                uuid.UUID(d["org_id"]), d["shift_id"]
            )
        }
        assert crew[d["crew_1"]]["calls_responded"] == 2
        assert crew[d["crew_2"]]["calls_responded"] == 1
        assert crew[d["crew_1"]]["calls_source"] == "call_log"

    async def _batch(self, svc, d, member_call_counts):
        return await svc.batch_create_reports(
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
            member_call_counts=member_call_counts,
        )

    async def _stored(self, db_session, d):
        rows = (
            await db_session.execute(
                text(
                    "SELECT trainee_id, calls_responded, call_types "
                    "FROM shift_completion_reports WHERE shift_id = :sid"
                ),
                {"sid": d["shift_id"]},
            )
        ).all()
        return {
            r.trainee_id: (
                r.calls_responded,
                (
                    json.loads(r.call_types)
                    if isinstance(r.call_types, str)
                    else r.call_types
                ),
            )
            for r in rows
        }

    async def test_batch_stores_the_previewed_figures_when_untouched(
        self, db_session, setup_shift_with_crew
    ):
        d = setup_shift_with_crew
        await self._log_calls(
            db_session, d, [[d["crew_1"], d["crew_2"]], [d["crew_1"]]]
        )
        svc = ShiftCompletionService(db_session)
        await self._batch(svc, d, None)
        stored = await self._stored(db_session, d)
        assert stored[d["crew_1"]] == (2, ["medical", "medical"])
        assert stored[d["crew_2"]] == (1, ["medical"])

    async def test_batch_applies_a_correction_to_that_member_only(
        self, db_session, setup_shift_with_crew
    ):
        d = setup_shift_with_crew
        await self._log_calls(
            db_session, d, [[d["crew_1"], d["crew_2"]], [d["crew_1"]]]
        )
        svc = ShiftCompletionService(db_session)
        await self._batch(svc, d, {d["crew_2"]: 0})
        stored = await self._stored(db_session, d)
        assert stored[d["crew_1"]] == (2, ["medical", "medical"])
        # Lowered by the officer: the count is theirs, and the derived types
        # no longer describe it, so none are kept.
        assert stored[d["crew_2"]] == (0, [])

    async def test_a_correction_equal_to_the_derived_figure_changes_nothing(
        self, db_session, setup_shift_with_crew
    ):
        d = setup_shift_with_crew
        await self._log_calls(db_session, d, [[d["crew_1"]]])
        svc = ShiftCompletionService(db_session)
        await self._batch(svc, d, {d["crew_1"]: 1})
        stored = await self._stored(db_session, d)
        assert stored[d["crew_1"]] == (1, ["medical"])


class TestShiftOfficerAuthorship:
    """settings.shift_reports.authorship = "shift_officer": only the shift's
    assigned officer files its reports."""

    async def _set(self, db_session, d, shift_reports):
        await db_session.execute(
            text("UPDATE organizations SET settings = :s WHERE id = :id"),
            {"s": json.dumps({"shift_reports": shift_reports}), "id": d["org_id"]},
        )
        await db_session.flush()

    async def _single(self, svc, d, author, trainee):
        return await svc.create_report(
            organization_id=uuid.UUID(d["org_id"]),
            officer_id=uuid.UUID(author),
            trainee_id=trainee,
            shift_date=d["shift_date"],
            hours_on_shift=12.0,
            shift_id=d["shift_id"],
        )

    async def test_absent_setting_keeps_the_original_rule(
        self, db_session, setup_shift_with_crew
    ):
        d = setup_shift_with_crew
        svc = ShiftCompletionService(db_session)
        # crew_1 is not the shift officer, and may file under the default.
        assert await self._single(svc, d, d["crew_1"], d["crew_2"])

    async def test_malformed_setting_degrades_to_the_original_rule(
        self, db_session, setup_shift_with_crew
    ):
        d = setup_shift_with_crew
        await self._set(db_session, d, "not-a-dict")
        svc = ShiftCompletionService(db_session)
        assert await self._single(svc, d, d["crew_1"], d["crew_2"])

    async def test_the_shift_officer_may_file(self, db_session, setup_shift_with_crew):
        d = setup_shift_with_crew
        await self._set(db_session, d, {"authorship": "shift_officer"})
        svc = ShiftCompletionService(db_session)
        assert await self._single(svc, d, d["officer_id"], d["crew_1"])

    async def test_another_officer_may_not(self, db_session, setup_shift_with_crew):
        d = setup_shift_with_crew
        await self._set(db_session, d, {"authorship": "shift_officer"})
        svc = ShiftCompletionService(db_session)
        with pytest.raises(ValueError, match="filed by that shift's officer"):
            await self._single(svc, d, d["crew_1"], d["crew_2"])

    async def test_a_shift_with_no_officer_says_so(
        self, db_session, setup_shift_with_crew
    ):
        d = setup_shift_with_crew
        await self._set(db_session, d, {"authorship": "shift_officer"})
        await db_session.execute(
            text("UPDATE shifts SET shift_officer_id = NULL WHERE id = :id"),
            {"id": d["shift_id"]},
        )
        svc = ShiftCompletionService(db_session)
        with pytest.raises(ValueError, match="none assigned"):
            await self._single(svc, d, d["officer_id"], d["crew_1"])

    async def test_a_batch_by_another_officer_is_refused_outright(
        self, db_session, setup_shift_with_crew
    ):
        # Not "skipped" row by row: the officer needs to be told why.
        d = setup_shift_with_crew
        await self._set(db_session, d, {"authorship": "shift_officer"})
        svc = ShiftCompletionService(db_session)
        with pytest.raises(ValueError, match="filed by that shift's officer"):
            await svc.batch_create_reports(
                organization_id=uuid.UUID(d["org_id"]),
                officer_id=uuid.UUID(d["crew_1"]),
                shift_id=d["shift_id"],
                shift_date=d["shift_date"],
                hours_on_shift=12.0,
                calls_responded=0,
                call_types=None,
                officer_narrative=None,
                crew_member_ids=[d["crew_2"]],
                trainee_evaluations=None,
            )

    async def _drafts(self, db_session, d, finalized_by):
        from app.services.scheduling_service import SchedulingService

        await db_session.execute(
            text(
                "UPDATE shift_assignments SET is_training = 1, "
                "training_evaluator_id = :ev WHERE shift_id = :sid AND user_id = :uid"
            ),
            {"sid": d["shift_id"], "uid": d["crew_1"], "ev": d["crew_2"]},
        )
        officer = (
            await db_session.execute(
                text("SELECT shift_officer_id FROM shifts WHERE id = :id"),
                {"id": d["shift_id"]},
            )
        ).scalar()
        shift = SimpleNamespace(
            id=d["shift_id"],
            shift_date=d["shift_date"],
            start_time=None,
            end_time=None,
            shift_officer_id=officer,
        )
        return await SchedulingService(db_session)._create_draft_reports_for_trainees(
            shift=shift,
            organization_id=uuid.UUID(d["org_id"]),
            finalized_by_user_id=finalized_by,
        )

    async def test_finalize_drafts_belong_to_the_shift_officer(
        self, db_session, setup_shift_with_crew
    ):
        # Not the slot's evaluator (crew_2), not the finalizer (crew_2): only
        # the shift officer may complete a draft under this rule.
        d = setup_shift_with_crew
        await self._set(db_session, d, {"authorship": "shift_officer"})
        assert await self._drafts(db_session, d, d["crew_2"]) == 1
        author = (
            await db_session.execute(
                text(
                    "SELECT officer_id FROM shift_completion_reports "
                    "WHERE shift_id = :sid"
                ),
                {"sid": d["shift_id"]},
            )
        ).scalar()
        assert author == d["officer_id"]

    async def test_finalize_drafts_nothing_without_a_shift_officer(
        self, db_session, setup_shift_with_crew
    ):
        d = setup_shift_with_crew
        await self._set(db_session, d, {"authorship": "shift_officer"})
        await db_session.execute(
            text("UPDATE shifts SET shift_officer_id = NULL WHERE id = :id"),
            {"id": d["shift_id"]},
        )
        assert await self._drafts(db_session, d, d["crew_2"]) == 0


class TestCallTypesNamedByRequirements:
    """A type a requirement counts is locked against deletion, matched by type
    — slug, label, or legacy text — and only within the department."""

    async def _requirement(self, db_session, org_id, types):
        from app.models.training import (
            RequirementFrequency,
            RequirementType,
            TrainingRequirement,
        )

        db_session.add(
            TrainingRequirement(
                organization_id=org_id,
                name=f"Calls {types}",
                requirement_type=RequirementType.CALLS,
                frequency=RequirementFrequency.ANNUAL,
                required_calls=5,
                required_call_types=types,
            )
        )
        await db_session.flush()

    async def test_slug_and_label_both_lock_the_type(
        self, db_session, setup_shift_with_crew
    ):
        from app.services.call_tracking_service import CallTrackingService

        d = setup_shift_with_crew
        await self._requirement(db_session, d["org_id"], ["mva"])
        await self._requirement(db_session, d["org_id"], ["Fire"])
        named = await CallTrackingService(db_session).slugs_named_by_requirements(
            d["org_id"], {"mva", "fire", "ems", "hazmat"}
        )
        assert named == {"mva", "fire"}

    async def test_another_departments_requirement_does_not_lock(
        self, db_session, two_orgs
    ):
        from app.services.call_tracking_service import CallTrackingService

        org_a, org_b = two_orgs["org_a"], two_orgs["org_b"]
        await self._requirement(db_session, org_b, ["hazmat"])
        named = await CallTrackingService(db_session).slugs_named_by_requirements(
            org_a, {"hazmat"}
        )
        assert named == set()


class TestTypeSpecificCallCredit:
    """A requirement counts the calls of its type however the report spelled
    them. Exact string matching credited a slug requirement nothing from a
    report holding the type's label."""

    async def test_slug_requirement_credits_label_calls(
        self, db_session, setup_training_org
    ):
        from app.models.training import (
            ProgramEnrollment,
            ProgramRequirement,
            RequirementFrequency,
            RequirementProgress,
            RequirementType,
            TrainingProgram,
            TrainingRequirement,
        )

        org_id, officer_id, trainee_id = setup_training_org
        program = TrainingProgram(organization_id=org_id, name="Driver")
        requirement = TrainingRequirement(
            organization_id=org_id,
            name="MVA responses",
            requirement_type=RequirementType.CALLS,
            frequency=RequirementFrequency.ONE_TIME,
            required_calls=10,
            required_call_types=["mva"],
        )
        db_session.add_all([program, requirement])
        await db_session.flush()
        enrollment = ProgramEnrollment(
            organization_id=org_id, user_id=trainee_id, program_id=program.id
        )
        db_session.add_all(
            [
                enrollment,
                ProgramRequirement(
                    program_id=program.id, requirement_id=requirement.id
                ),
            ]
        )
        await db_session.flush()
        progress = RequirementProgress(
            enrollment_id=enrollment.id, requirement_id=requirement.id
        )
        db_session.add(progress)
        await db_session.flush()

        svc = ShiftCompletionService(db_session)
        await svc.create_report(
            organization_id=uuid.UUID(org_id),
            officer_id=uuid.UUID(officer_id),
            trainee_id=trainee_id,
            shift_date=date.today(),
            hours_on_shift=12.0,
            calls_responded=3,
            # The built-in list labels mva "Motor Vehicle Accident".
            call_types=["Motor Vehicle Accident", "Fire", "motor vehicle accident"],
        )
        await db_session.refresh(progress)
        assert progress.progress_value == 2
