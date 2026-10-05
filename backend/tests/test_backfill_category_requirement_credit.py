"""The backfill repairs exactly the credit the broken category query missed.

Reproduces the pre-fix state rather than asserting against the fixed code's
own output: two requirements share a training category, one tagged with that
category alone and one tagged with it plus a second. The old query --
``category_ids LIKE '%["<id>"]%'`` against the serialized array -- matched only
the single-category one, so only that one carries a ledger row here. The
multi-category one is the gap the department actually had: the member attended,
the ``TrainingRecord`` was written, and the requirement never moved.

What is asserted, in the order the operator would do it:

1. the dry run finds the gap and nothing else (the already-credited pair is not
   re-listed, which is what makes the dry run trustworthy),
2. ``--apply`` writes it and the requirement's progress actually advances,
3. a second ``--apply`` writes nothing -- the ledger key makes the script
   re-runnable, which is the property the whole design rests on,
4. ``--restore`` reverses what the run wrote and leaves the pre-existing credit
   standing.

Marked ``integration``: every assertion here is about rows, and the
no-database unit job cannot run them (CLAUDE.md pitfall #30b).
"""

import importlib.util
import json
import pathlib
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select

from app.models.event import Event
from app.models.training import (
    DueDateType,
    EnrollmentStatus,
    ProgramEnrollment,
    ProgressCreditSource,
    RequirementFrequency,
    RequirementProgress,
    RequirementProgressCredit,
    RequirementType,
    TrainingCategory,
    TrainingProgram,
    TrainingRecord,
    TrainingRequirement,
    TrainingSession,
    TrainingStatus,
    TrainingType,
)
from app.models.user import Organization, User, UserStatus
from app.services.training_program_service import TrainingProgramService

pytestmark = [pytest.mark.integration]

SESSION_HOURS = 6.0


def _script():
    """Load the backfill as a module.

    It lives under ``scripts/`` and is not importable as a package, so it is
    loaded by path -- the same way its behavior is reached in production (a
    ``python scripts/...`` invocation), rather than through a wrapper written
    only for the test.
    """
    path = (
        pathlib.Path(__file__).resolve().parents[1]
        / "scripts"
        / "backfill_category_requirement_credit.py"
    )
    spec = importlib.util.spec_from_file_location("backfill_category_credit", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.fixture
async def scenario(db_session):
    """An org whose multi-category requirement never received its session hours."""
    handle = uuid.uuid4().hex[:8]
    org = Organization(
        id=str(uuid.uuid4()),
        name=f"Backfill Department {handle}",
        slug=f"backfill-{handle}",
        timezone="UTC",
    )
    db_session.add(org)
    await db_session.flush()

    user = User(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        username=f"member-{handle}",
        email=f"{handle}@backfill.test",
        first_name="Pat",
        last_name="Member",
        password_hash="x",
        status=UserStatus.ACTIVE,
        membership_type="active",
    )
    db_session.add(user)

    program = TrainingProgram(
        id=str(uuid.uuid4()), organization_id=org.id, name="Recruit School"
    )
    db_session.add(program)
    await db_session.flush()

    # Real rows: `training_records.category_id` carries a foreign key to
    # `training_categories`, unlike the JSON `category_ids` on a requirement.
    categories = [
        TrainingCategory(
            id=str(uuid.uuid4()), organization_id=org.id, name=name, active=True
        )
        for name in ("Pump Operations", "Driver Training")
    ]
    db_session.add_all(categories)
    await db_session.flush()
    category_id = categories[0].id
    other_category_id = categories[1].id

    def _requirement(name, category_ids):
        return TrainingRequirement(
            id=str(uuid.uuid4()),
            organization_id=org.id,
            name=name,
            requirement_type=RequirementType.HOURS,
            required_hours=20.0,
            frequency=RequirementFrequency.ANNUAL,
            due_date_type=DueDateType.CALENDAR_PERIOD,
            active=True,
            category_ids=category_ids,
        )

    # The one the broken query matched, and the one it could not.
    single = _requirement("Single-Category Drill", [category_id])
    multi = _requirement("Multi-Category Drill", [category_id, other_category_id])
    db_session.add_all([single, multi])
    await db_session.flush()

    from app.models.training import ProgramRequirement

    for requirement in (single, multi):
        db_session.add(
            ProgramRequirement(
                id=str(uuid.uuid4()),
                program_id=program.id,
                requirement_id=requirement.id,
            )
        )

    enrollment = ProgramEnrollment(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        user_id=user.id,
        program_id=program.id,
        status=EnrollmentStatus.ACTIVE,
    )
    db_session.add(enrollment)
    await db_session.flush()

    progress = {}
    for requirement in (single, multi):
        row = RequirementProgress(
            id=str(uuid.uuid4()),
            enrollment_id=enrollment.id,
            requirement_id=requirement.id,
            progress_value=0.0,
        )
        db_session.add(row)
        progress[requirement.id] = row
    await db_session.flush()

    start = datetime.now(timezone.utc) - timedelta(days=30)
    event = Event(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        title="Pump Drill",
        start_datetime=start,
        end_datetime=start + timedelta(hours=SESSION_HOURS),
    )
    db_session.add(event)
    await db_session.flush()

    training_session = TrainingSession(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        event_id=event.id,
        course_name="Pump Drill",
        training_type=TrainingType.CONTINUING_EDUCATION,
        credit_hours=SESSION_HOURS,
        program_id=program.id,
        category_id=category_id,
        requirement_id=None,
        phase_id=None,
        counts_toward_certification=True,
    )
    db_session.add(training_session)

    record = TrainingRecord(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        user_id=user.id,
        source_event_id=event.id,
        category_id=category_id,
        course_name="Pump Drill",
        training_type=TrainingType.CONTINUING_EDUCATION,
        scheduled_date=start.date(),
        completion_date=start.date(),
        hours_completed=SESSION_HOURS,
        credit_hours=SESSION_HOURS,
        status=TrainingStatus.COMPLETED,
        created_by=user.id,
    )
    db_session.add(record)
    await db_session.flush()

    # The pre-fix state: only the single-category requirement was ever credited.
    service = TrainingProgramService(db_session)
    _, error = await service.apply_requirement_credit(
        progress_id=progress[single.id].id,
        organization_id=uuid.UUID(org.id),
        source_type=ProgressCreditSource.TRAINING_SESSION,
        source_id=str(training_session.id),
        units=SESSION_HOURS,
        can_manage=True,
    )
    assert error is None, error

    return {
        "org": org,
        "user": user,
        "program": program,
        "single": single,
        "multi": multi,
        "progress": progress,
        "session": training_session,
        "record": record,
    }


async def _ledger(db_session, progress_id) -> list:
    rows = await db_session.execute(
        select(RequirementProgressCredit).where(
            RequirementProgressCredit.progress_id == str(progress_id)
        )
    )
    return list(rows.scalars().all())


async def _progress_value(db_session, progress_id) -> float:
    row = await db_session.execute(
        select(RequirementProgress.progress_value).where(
            RequirementProgress.id == str(progress_id)
        )
    )
    return float(row.scalar() or 0)


class TestTheDryRunFindsTheGap:
    async def test_it_lists_the_multi_category_requirement_only(
        self, db_session, scenario
    ):
        script = _script()
        plan = await script._plan(db_session, scenario["org"].id, None, None)

        assert [c.requirement_id for c in plan.session_credits] == [
            scenario["multi"].id
        ], [c.requirement_name for c in plan.session_credits]

        credit = plan.session_credits[0]
        assert credit.units == SESSION_HOURS
        assert credit.user_id == scenario["user"].id
        assert credit.category_count == 2
        assert credit.source_type is ProgressCreditSource.TRAINING_SESSION
        assert credit.source_id == scenario["session"].id

    async def test_the_already_credited_requirement_is_counted_not_relisted(
        self, db_session, scenario
    ):
        """The property that makes the dry run worth reading: a pair already on
        the ledger is reported as such, never offered up for rewriting."""
        script = _script()
        plan = await script._plan(db_session, scenario["org"].id, None, None)

        assert plan.already_credited == 1
        assert scenario["single"].id not in {
            c.requirement_id for c in plan.session_credits
        }

    async def test_a_dry_run_writes_nothing(self, db_session, scenario):
        script = _script()
        before = await _progress_value(
            db_session, scenario["progress"][scenario["multi"].id].id
        )

        plan = await script._plan(db_session, scenario["org"].id, None, None)
        status = script._print_plan(plan, applying=False)

        assert status == 1, "a dry run with a gap should report 1"
        assert (
            await _ledger(db_session, scenario["progress"][scenario["multi"].id].id)
            == []
        )
        assert (
            await _progress_value(
                db_session, scenario["progress"][scenario["multi"].id].id
            )
            == before
        )


class TestApplyWritesTheMissingCredit:
    async def test_the_requirement_advances_by_the_session_hours(
        self, db_session, scenario
    ):
        script = _script()
        multi_progress_id = scenario["progress"][scenario["multi"].id].id

        plan = await script._plan(db_session, scenario["org"].id, None, None)
        assert await script._apply(db_session, plan, None, None) == 0

        ledger = await _ledger(db_session, multi_progress_id)
        assert len(ledger) == 1
        assert float(ledger[0].units) == SESSION_HOURS
        assert ledger[0].source_id == scenario["session"].id
        assert await _progress_value(db_session, multi_progress_id) == SESSION_HOURS

    async def test_the_already_credited_requirement_is_untouched(
        self, db_session, scenario
    ):
        script = _script()
        single_progress_id = scenario["progress"][scenario["single"].id].id
        before = await _progress_value(db_session, single_progress_id)

        plan = await script._plan(db_session, scenario["org"].id, None, None)
        await script._apply(db_session, plan, None, None)

        assert len(await _ledger(db_session, single_progress_id)) == 1
        assert await _progress_value(db_session, single_progress_id) == before

    async def test_a_second_run_writes_nothing(self, db_session, scenario):
        """Re-runnability is not a nicety here -- an interrupted run is resumed
        by re-running, so a second pass must be inert."""
        script = _script()
        multi_progress_id = scenario["progress"][scenario["multi"].id].id

        first = await script._plan(db_session, scenario["org"].id, None, None)
        await script._apply(db_session, first, None, None)
        after_first = await _progress_value(db_session, multi_progress_id)

        second = await script._plan(db_session, scenario["org"].id, None, None)
        assert second.session_credits == []
        assert script._print_plan(second, applying=False) == 0
        await script._apply(db_session, second, None, None)

        assert len(await _ledger(db_session, multi_progress_id)) == 1
        assert await _progress_value(db_session, multi_progress_id) == after_first


class TestRestoreReversesOnlyWhatTheRunWrote:
    async def test_the_backfilled_credit_comes_off_and_the_original_stays(
        self, db_session, scenario, tmp_path
    ):
        script = _script()
        multi_progress_id = scenario["progress"][scenario["multi"].id].id
        single_progress_id = scenario["progress"][scenario["single"].id].id
        rollback = tmp_path / "rollback.json"

        plan = await script._plan(db_session, scenario["org"].id, None, None)
        await script._apply(db_session, plan, str(rollback), None)

        payload = json.loads(rollback.read_text())
        assert len(payload["credits"]) == 1
        assert payload["credits"][0]["progress_id"] == str(multi_progress_id)

        assert await script._restore(db_session, str(rollback)) == 0

        assert await _ledger(db_session, multi_progress_id) == []
        assert await _progress_value(db_session, multi_progress_id) == 0.0
        # The credit the backfill did not write is the credit it must not remove.
        assert len(await _ledger(db_session, single_progress_id)) == 1
