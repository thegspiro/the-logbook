"""Company drills from a historical import.

Pins the rules agreed with the department:

  * a CompanyDrill date counts as a held drill when at least three members
    logged it (configurable); fewer stay ordinary training records;
  * each held drill becomes one past, finalized training session linked to
    the session-attendance requirements the IT Admin chose, and each member's
    imported record of that date is attached to it, once per member;
  * it runs after the training step and is safe to run again: nothing is
    created twice, and the sessions are re-linked to the requirements chosen
    now.
"""

from datetime import date

import pytest
from sqlalchemy import select

from app.models.event import Event
from app.models.training import (
    RequirementFrequency,
    RequirementSource,
    RequirementType,
    TrainingRecord,
    TrainingRequirement,
    TrainingSession,
    TrainingSessionRequirement,
)
from app.services import historical_import_engine as engine
from app.services.historical_import_service import (
    HistoricalImportNotReady,
    HistoricalImportService,
)
from app.services.training_compliance import (
    load_held_sessions,
    tally_session_attendance,
)
from tests.test_historical_import import _add_user, _uid, _world

DRILL_CSV = "\n".join(
    [
        "VID,Date,Start,End,Training,UniqueID,TrainingSubject,TrainingInstructor,"
        "Instructor,CompanyDrill",
        # A held drill: three members on one evening.
        "101,2016-05-02,1900,2100,2.0,9101,Hose,Capt,0,1",
        "102,2016-05-02,1900,2100,2.0,9102,Hose,Capt,0,1",
        "103,2016-05-02,1915,2100,1.75,9103,Hose,Capt,0,1",
        # Alice logged the same evening twice: one attendance.
        "101,2016-05-02,2100,2130,0.5,9104,Hose cleanup,Capt,0,1",
        # One member alone: her own training, flagged as a drill.
        "101,2016-05-09,1900,2000,1.0,9105,Pump,Self,0,1",
        # Not a drill at all.
        "104,2016-05-16,1900,2000,1.0,9106,CPR,AHA,0,0",
    ]
)


@pytest.mark.unit
class TestTheRule:
    def test_the_column_is_found_and_the_threshold_kept_in_range(self):
        settings = engine.detect_training_settings(
            ["VID", "Date", "CompanyDrill", "TrainingSubject"]
        )
        assert settings.drill_column == "CompanyDrill"
        assert settings.drill_min_members == 3
        assert engine.TrainingSettings.from_stored(
            {"drill_min_members": 500}
        ).drill_min_members == (engine.MAX_DRILL_MIN_MEMBERS)
        assert (
            engine.TrainingSettings.from_stored(
                {"drill_min_members": "x"}
            ).drill_min_members
            == 3
        )

    def test_members_are_counted_once(self):
        day = engine.DrillDay(day=date(2016, 5, 2))
        for key in ("a", "a", "b"):
            day.member_keys.add(key)
        assert not day.qualifies(3)
        day.member_keys.add("c")
        assert day.qualifies(3)


async def _requirement(
    db, org, name, requirement_type=RequirementType.SESSION_ATTENDANCE
):
    requirement = TrainingRequirement(
        id=_uid(),
        organization_id=org,
        name=name,
        requirement_type=requirement_type,
        source=RequirementSource.DEPARTMENT,
        frequency=RequirementFrequency.ANNUAL,
        year=2016,
        required_attendance_pct=50,
        required_hours=1,
        active=True,
    )
    db.add(requirement)
    await db.flush()
    return requirement


async def _drill_world(db_session):
    org, admin = await _world(db_session)
    await _add_user(db_session, org, "Cara", "Lee", "103")
    await _add_user(db_session, org, "Dan", "Ruiz", "104")
    active = await _requirement(db_session, org, "Company drills — active")
    senior = await _requirement(db_session, org, "Company drills — senior")
    await db_session.commit()
    service = HistoricalImportService(db_session)
    record = await service.create(
        org, admin, "drills.csv", DRILL_CSV, "FCVFD Hours DB", None
    )
    return service, org, admin, record, active, senior


async def _commit_training(service, org, admin, record):
    await service.commit_training(org, record.id, admin)


@pytest.mark.integration
class TestDrillImport:
    async def test_the_preview_finds_the_held_drill_and_waits_for_training(
        self, db_session
    ):
        service, org, _, record, active, senior = await _drill_world(db_session)

        preview = await service.drill_preview(await service.get(org, record.id))

        assert preview["settings"]["drill_column"] == "CompanyDrill"
        assert (preview["drill_dates"], preview["qualifying_dates"]) == (2, 1)
        assert preview["qualifying_rows"] == 4
        assert [(d["date"], d["members"]) for d in preview["dates"]] == [
            (date(2016, 5, 2), 3)
        ]
        assert {r["id"] for r in preview["requirements"]} == {active.id, senior.id}
        assert preview["training_committed"] is False
        assert preview["can_commit"] is False

    async def test_it_refuses_before_the_training_step(self, db_session):
        service, org, admin, record, active, _ = await _drill_world(db_session)
        await service.update_training_settings(
            await service.get(org, record.id), {"drill_requirement_ids": [active.id]}
        )

        with pytest.raises(HistoricalImportNotReady, match="training rows first"):
            await service.commit_drills(org, record.id, admin)

    async def test_a_held_drill_becomes_a_graded_session(self, db_session):
        service, org, admin, record, active, senior = await _drill_world(db_session)
        await _commit_training(service, org, admin, record)
        await service.update_training_settings(
            await service.get(org, record.id),
            {"drill_requirement_ids": [active.id, senior.id]},
        )

        counts = await service.commit_drills(org, record.id, admin)

        assert counts == {
            "sessions_created": 1,
            "sessions_relinked": 0,
            "records_attached": 3,
        }
        session = (
            await db_session.execute(
                select(TrainingSession).where(TrainingSession.organization_id == org)
            )
        ).scalar_one()
        event = await db_session.get(Event, session.event_id)
        assert session.is_finalized is True
        assert event.attendance_finalized_at is not None
        links = (
            (
                await db_session.execute(
                    select(TrainingSessionRequirement.requirement_id).where(
                        TrainingSessionRequirement.session_id == session.id
                    )
                )
            )
            .scalars()
            .all()
        )
        assert set(links) == {active.id, senior.id}
        attached = (
            (
                await db_session.execute(
                    select(TrainingRecord).where(
                        TrainingRecord.organization_id == org,
                        TrainingRecord.source_event_id == event.id,
                    )
                )
            )
            .scalars()
            .all()
        )
        assert len(attached) == 3
        assert len({r.user_id for r in attached}) == 3

        held = await load_held_sessions(db_session, org, [active])
        assert [s.held_on for s in held[active.id]] == [date(2016, 5, 2)]
        tally = tally_session_attendance(
            active, attached[:1], held[active.id], date(2016, 12, 31)
        )
        assert (tally.attended, tally.held) == (1, 1)

    async def test_running_it_again_creates_nothing_and_relinks(self, db_session):
        service, org, admin, record, active, senior = await _drill_world(db_session)
        await _commit_training(service, org, admin, record)
        await service.update_training_settings(
            await service.get(org, record.id), {"drill_requirement_ids": [active.id]}
        )
        await service.commit_drills(org, record.id, admin)
        await service.update_training_settings(
            await service.get(org, record.id), {"drill_requirement_ids": [senior.id]}
        )

        counts = await service.commit_drills(org, record.id, admin)

        assert counts == {
            "sessions_created": 0,
            "sessions_relinked": 1,
            "records_attached": 0,
        }
        links = (
            (
                await db_session.execute(
                    select(TrainingSessionRequirement.requirement_id)
                )
            )
            .scalars()
            .all()
        )
        assert links == [senior.id]
        preview = await service.drill_preview(await service.get(org, record.id))
        assert preview["sessions_created"] == 1
        assert preview["dates"][0]["session_created"] is True

    async def test_only_this_departments_attendance_requirements_are_accepted(
        self, db_session
    ):
        service, org, _, record, _, _ = await _drill_world(db_session)
        hours = await _requirement(
            db_session, org, "Annual hours", RequirementType.HOURS
        )
        other_org, _ = await _world(db_session)
        foreign = await _requirement(db_session, other_org, "Their drills")

        for bad in (hours.id, foreign.id):
            with pytest.raises(ValueError, match="session-attendance"):
                await service.update_training_settings(
                    await service.get(org, record.id),
                    {"drill_requirement_ids": [bad]},
                )

    async def test_a_higher_threshold_leaves_no_held_drill(self, db_session):
        service, org, admin, record, active, _ = await _drill_world(db_session)
        await _commit_training(service, org, admin, record)
        await service.update_training_settings(
            await service.get(org, record.id),
            {"drill_requirement_ids": [active.id], "drill_min_members": 4},
        )

        with pytest.raises(HistoricalImportNotReady, match="enough members"):
            await service.commit_drills(org, record.id, admin)
