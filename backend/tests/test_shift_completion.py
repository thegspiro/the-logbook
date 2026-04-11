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

import pytest
import uuid
from datetime import date, timedelta

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
        d = await two_orgs
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
        d = await two_orgs
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
        d = await two_orgs
        svc = ShiftCompletionService(db_session)

        report = await svc.create_report(
            organization_id=uuid.UUID(d["org_a"]),
            officer_id=uuid.UUID(d["officer_a"]),
            trainee_id=d["trainee_a"],
            shift_date=date.today(),
            hours_on_shift=12.0,
            review_status="draft",
        )

        with pytest.raises(ValueError, match="organization"):
            await svc.update_report(
                report.id,
                uuid.UUID(d["org_b"]),
                d["officer_a"],
                {"hours_on_shift": 24.0},
            )

    async def test_update_report_wrong_officer(self, db_session, two_orgs):
        d = await two_orgs
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
        d = await two_orgs
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
        org_id, officer_id, trainee_id = await setup_training_org
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
        org_id, officer_id, trainee_id = await setup_training_org
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

    async def test_update_enrollment_id_on_draft(
        self, db_session, setup_training_org
    ):
        org_id, officer_id, trainee_id = await setup_training_org
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

        fake_enrollment = _uid()
        updated = await svc.update_report(
            report.id,
            uuid.UUID(org_id),
            officer_id,
            {"enrollment_id": fake_enrollment},
        )
        assert updated is not None
        assert updated.enrollment_id == fake_enrollment


# ── Update Whitelist Tests ──────────────────────────────────────────


class TestUpdateWhitelist:

    async def test_whitelisted_fields_apply(self, db_session, setup_training_org):
        org_id, officer_id, trainee_id = await setup_training_org
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
        org_id, officer_id, trainee_id = await setup_training_org
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
            "st": f"{today}T08:00:00+00:00",
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

    async def test_get_shift_crew_status(
        self, db_session, setup_shift_with_crew
    ):
        d = await setup_shift_with_crew
        svc = ShiftCompletionService(db_session)

        crew = await svc.get_shift_crew_status(
            uuid.UUID(d["org_id"]), d["shift_id"]
        )
        assert len(crew) == 3
        user_ids = {m["user_id"] for m in crew}
        assert d["officer_id"] in user_ids
        assert d["crew_1"] in user_ids
        assert d["crew_2"] in user_ids
        assert all(not m["has_existing_report"] for m in crew)

    async def test_crew_status_wrong_org_returns_empty(
        self, db_session, setup_shift_with_crew
    ):
        d = await setup_shift_with_crew
        svc = ShiftCompletionService(db_session)

        crew = await svc.get_shift_crew_status(
            uuid.uuid4(), d["shift_id"]
        )
        assert crew == []

    async def test_crew_status_marks_reported_members(
        self, db_session, setup_shift_with_crew
    ):
        d = await setup_shift_with_crew
        svc = ShiftCompletionService(db_session)

        await svc.create_report(
            organization_id=uuid.UUID(d["org_id"]),
            officer_id=uuid.UUID(d["officer_id"]),
            trainee_id=d["crew_1"],
            shift_date=d["shift_date"],
            hours_on_shift=12.0,
            shift_id=d["shift_id"],
        )

        crew = await svc.get_shift_crew_status(
            uuid.UUID(d["org_id"]), d["shift_id"]
        )
        reported = {
            m["user_id"] for m in crew if m["has_existing_report"]
        }
        not_reported = {
            m["user_id"] for m in crew if not m["has_existing_report"]
        }
        assert d["crew_1"] in reported
        assert d["crew_2"] in not_reported

    async def test_batch_create_reports(
        self, db_session, setup_shift_with_crew
    ):
        d = await setup_shift_with_crew
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
        )
        assert result["created"] == 2
        assert result["skipped"] == 0
        assert len(result["report_ids"]) == 2

    async def test_batch_skips_duplicate_reports(
        self, db_session, setup_shift_with_crew
    ):
        d = await setup_shift_with_crew
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
        )
        assert result["created"] == 1
        assert result["skipped"] == 1


# ── Shift-Linked Validation Tests ───────────────────────────────────


class TestShiftLinkedValidation:

    async def test_report_date_must_match_shift(
        self, db_session, setup_shift_with_crew
    ):
        d = await setup_shift_with_crew
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
        d = await setup_shift_with_crew
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

    async def test_shift_wrong_org_rejected(
        self, db_session, setup_shift_with_crew
    ):
        d = await setup_shift_with_crew
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

    async def test_validate_shift_ownership(
        self, db_session, setup_shift_with_crew
    ):
        d = await setup_shift_with_crew
        svc = ShiftCompletionService(db_session)

        assert await svc.validate_shift_ownership(
            d["shift_id"], uuid.UUID(d["org_id"])
        )
        assert not await svc.validate_shift_ownership(
            d["shift_id"], uuid.uuid4()
        )
        assert not await svc.validate_shift_ownership(
            _uid(), uuid.UUID(d["org_id"])
        )
