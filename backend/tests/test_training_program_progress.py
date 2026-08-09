"""
Tests for training enrollment progress rollup
(app/services/training_program_service.py :: _recalculate_enrollment_progress).

The overall enrollment percentage is the average of its *required* items'
progress, and the enrollment auto-completes (with a notification) once that
average reaches 100%. Uses a recording fake session so the issued UPDATE
statements can be counted. DB mocked; no MySQL.
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

from app.models.training import EnrollmentStatus
from app.services.training_program_service import (
    RequirementProgressUpdate,
    TrainingProgramService,
)


def _one(obj):
    return MagicMock(scalar_one_or_none=MagicMock(return_value=obj))


def _scalars(items):
    r = MagicMock()
    r.scalars.return_value.all.return_value = items
    return r


class RecordingSession:
    """Minimal async session that returns queued results and records the
    SQL statement objects passed to execute (so UPDATEs can be counted)."""

    def __init__(self, results):
        self._results = list(results)
        self.statements = []
        self.added = []
        self.commit = AsyncMock()
        self.refresh = AsyncMock()
        self.flush = AsyncMock()

    def add(self, obj):
        self.added.append(obj)

    async def execute(self, statement, *args, **kwargs):
        # Compile every statement before answering it. A mocked session never
        # touches the ORM otherwise, and some construction errors — notably a
        # join with no inferable ON clause — surface only at compile time, so
        # without this the suite happily passes queries that 500 in production.
        str(statement)
        self.statements.append(statement)
        return self._results.pop(0) if self._results else MagicMock()

    def update_count(self):
        return sum(1 for s in self.statements if type(s).__name__ == "Update")


def _enrollment(status=EnrollmentStatus.ACTIVE, percentage=0.0):
    return SimpleNamespace(
        id="enr-1",
        organization_id="org-1",
        program_id="prog-1",
        status=status,
        user_id="u1",
        progress_percentage=percentage,
    )


def _prog(pct, requirement_id=None):
    return SimpleNamespace(
        progress_percentage=pct,
        requirement_id=requirement_id or f"req-{pct}",
    )


def _required(*requirement_ids):
    """The id set returned by get_required_requirement_ids()."""
    return _scalars(list(requirement_ids))


class TestRecalculateEnrollmentProgress:
    async def test_missing_enrollment_is_noop(self):
        db = RecordingSession([_one(None)])
        await TrainingProgramService(db)._recalculate_enrollment_progress("enr-1")
        assert db.update_count() == 0
        db.commit.assert_not_awaited()

    async def test_program_without_required_items_is_noop(self):
        db = RecordingSession([_one(_enrollment()), _required()])
        await TrainingProgramService(db)._recalculate_enrollment_progress("enr-1")
        assert db.update_count() == 0

    async def test_no_required_progress_is_noop(self):
        db = RecordingSession([_one(_enrollment()), _required("r1"), _scalars([])])
        await TrainingProgramService(db)._recalculate_enrollment_progress("enr-1")
        assert db.update_count() == 0

    async def test_partial_progress_updates_without_completing(self):
        # Average of 40 and 60 = 50 -> one UPDATE (percentage), no completion.
        db = RecordingSession(
            [
                _one(_enrollment()),
                _required("r1", "r2"),
                _scalars([_prog(40.0, "r1"), _prog(60.0, "r2")]),
                MagicMock(),  # update percentage
                _scalars([]),  # milestone lookup
            ]
        )
        await TrainingProgramService(db)._recalculate_enrollment_progress("enr-1")
        assert db.update_count() == 1
        db.commit.assert_awaited()

    async def test_a_requirement_linked_twice_counts_once(self):
        # Same requirement in two phases: two progress rows at 100 and 0 must
        # not average to 50 — the requirement is one item, and its best standing
        # is what counts.
        db = RecordingSession(
            [
                _one(_enrollment()),
                _required("r1", "r2"),
                _scalars([_prog(100.0, "r1"), _prog(0.0, "r1"), _prog(100.0, "r2")]),
                MagicMock(),  # update percentage
                MagicMock(),  # update status=completed
                _scalars([]),  # milestone lookup
                _one(None),  # program fetch (notification path)
            ]
        )
        await TrainingProgramService(db)._recalculate_enrollment_progress("enr-1")
        assert db.update_count() == 2

    async def test_completion_marks_and_notifies_when_newly_complete(self, monkeypatch):
        # Average 100 from a not-yet-completed enrollment -> two UPDATEs
        # (percentage + status) and a completion notification.
        program = SimpleNamespace(id="prog-1", name="FF1", organization_id=str(uuid4()))
        svc = TrainingProgramService(
            RecordingSession(
                [
                    _one(_enrollment(status=EnrollmentStatus.ACTIVE)),
                    _required("r1", "r2"),
                    _scalars([_prog(100.0, "r1"), _prog(100.0, "r2")]),
                    MagicMock(),  # update percentage
                    MagicMock(),  # update status=completed
                    _scalars([]),  # milestone lookup
                    _one(program),  # program fetch
                    _one(SimpleNamespace(id="u1")),  # user fetch
                ]
            )
        )
        notify = AsyncMock()
        monkeypatch.setattr(svc, "_notify_program_completion", notify)
        monkeypatch.setattr(svc, "_handle_evoc_completion", AsyncMock())
        await svc._recalculate_enrollment_progress("enr-1")
        assert svc.db.update_count() == 2
        notify.assert_awaited_once()

    async def test_already_completed_does_not_renotify(self, monkeypatch):
        # Average 100 but enrollment was already COMPLETED -> no notification.
        svc = TrainingProgramService(
            RecordingSession(
                [
                    _one(
                        _enrollment(status=EnrollmentStatus.COMPLETED, percentage=100.0)
                    ),
                    _required("r1"),
                    _scalars([_prog(100.0, "r1")]),
                    MagicMock(),
                    MagicMock(),
                ]
            )
        )
        notify = AsyncMock()
        monkeypatch.setattr(svc, "_notify_program_completion", notify)
        await svc._recalculate_enrollment_progress("enr-1")
        notify.assert_not_awaited()


class TestMilestoneNotifications:
    """Crossing a milestone threshold notifies the member — the wizard promises
    it, and nothing evaluated milestones before."""

    def _milestone(self, name="Halfway", threshold=50.0, message=None):
        return SimpleNamespace(
            name=name,
            completion_percentage_threshold=threshold,
            notification_message=message,
        )

    async def test_crossed_milestone_notifies_once(self, monkeypatch):
        svc = TrainingProgramService(
            RecordingSession(
                [
                    _one(_enrollment(percentage=20.0)),
                    _required("r1", "r2"),
                    _scalars([_prog(100.0, "r1"), _prog(20.0, "r2")]),
                    MagicMock(),  # update percentage -> 60
                    _scalars([self._milestone(threshold=50.0)]),
                ]
            )
        )
        logged = AsyncMock()
        monkeypatch.setattr(
            "app.services.training_program_service.NotificationsService",
            lambda db: SimpleNamespace(log_notification=logged),
        )
        await svc._recalculate_enrollment_progress("enr-1")
        logged.assert_awaited_once()
        payload = logged.await_args.kwargs["log_data"]
        assert payload["recipient_id"] == "u1"
        assert payload["action_url"] == "/training/my-progress/enr-1"

    async def test_progress_that_does_not_advance_notifies_nothing(self, monkeypatch):
        svc = TrainingProgramService(
            RecordingSession(
                [
                    _one(_enrollment(percentage=60.0)),
                    _required("r1", "r2"),
                    _scalars([_prog(100.0, "r1"), _prog(20.0, "r2")]),
                    MagicMock(),  # update percentage -> 60, unchanged
                ]
            )
        )
        logged = AsyncMock()
        monkeypatch.setattr(
            "app.services.training_program_service.NotificationsService",
            lambda db: SimpleNamespace(log_notification=logged),
        )
        await svc._recalculate_enrollment_progress("enr-1")
        logged.assert_not_awaited()


class TestUpdateRequirementProgressAuth:
    """A member may only update their own progress; officers (can_manage) or
    system callers (no acting_user_id) may update anyone's."""

    def _progress(self, owner="owner"):
        return SimpleNamespace(
            id="p1",
            enrollment_id="enr-1",
            enrollment=SimpleNamespace(user_id=owner),
            updated_at=None,
        )

    def _db_with(self, progress):
        db = MagicMock()
        db.execute = AsyncMock(
            return_value=MagicMock(scalar_one_or_none=MagicMock(return_value=progress))
        )
        db.commit = AsyncMock()
        db.refresh = AsyncMock()
        return db

    async def test_member_cannot_update_others_progress(self):
        svc = TrainingProgramService(self._db_with(self._progress(owner="owner")))
        out, err = await svc.update_requirement_progress(
            progress_id="p1",
            organization_id="org-1",
            updates=RequirementProgressUpdate(),
            acting_user_id="attacker",
            can_manage=False,
        )
        assert out is None
        assert "not authorized" in err

    async def test_member_can_update_own_progress(self, monkeypatch):
        svc = TrainingProgramService(self._db_with(self._progress(owner="me")))
        monkeypatch.setattr(svc, "_recalculate_enrollment_progress", AsyncMock())
        out, err = await svc.update_requirement_progress(
            progress_id="p1",
            organization_id="org-1",
            updates=RequirementProgressUpdate(),
            acting_user_id="me",
            can_manage=False,
        )
        assert err is None
        assert out is not None

    async def test_manager_can_update_any_progress(self, monkeypatch):
        svc = TrainingProgramService(self._db_with(self._progress(owner="owner")))
        monkeypatch.setattr(svc, "_recalculate_enrollment_progress", AsyncMock())
        _, err = await svc.update_requirement_progress(
            progress_id="p1",
            organization_id="org-1",
            updates=RequirementProgressUpdate(),
            acting_user_id="officer",
            can_manage=True,
        )
        assert err is None

    async def test_system_call_without_acting_user_allowed(self, monkeypatch):
        svc = TrainingProgramService(self._db_with(self._progress(owner="owner")))
        monkeypatch.setattr(svc, "_recalculate_enrollment_progress", AsyncMock())
        _, err = await svc.update_requirement_progress(
            progress_id="p1",
            organization_id="org-1",
            updates=RequirementProgressUpdate(),
        )
        assert err is None


class TestEnrollmentProgressRows:
    """Enrollment tracks one progress row per requirement, not per link."""

    async def test_a_requirement_in_two_phases_gets_one_progress_row(self, monkeypatch):
        from app.models.training import RequirementProgress
        from app.schemas.training_program import ProgramEnrollmentCreate

        shared_id = str(uuid4())
        program = SimpleNamespace(
            id=str(uuid4()),
            organization_id="org-1",
            structure_type="flexible",
            phases=[],
            time_limit_days=None,
            recert_enabled=False,
        )
        links = [
            SimpleNamespace(requirement_id=shared_id),
            SimpleNamespace(requirement_id=shared_id),  # same item, second phase
            SimpleNamespace(requirement_id=str(uuid4())),
        ]
        db = RecordingSession(
            [
                _one(program),  # get_program_by_id
                _one(SimpleNamespace(id="u1")),  # user lookup
                _one(None),  # no existing active enrollment
                _one(program),  # get_program_requirements -> get_program_by_id
                _scalars(links),  # the program's requirement links
            ]
        )
        svc = TrainingProgramService(db)
        monkeypatch.setattr(svc, "_notify_enrollment", AsyncMock())

        enrollment, error = await svc.enroll_member(
            ProgramEnrollmentCreate(user_id=uuid4(), program_id=uuid4()),
            uuid4(),
        )

        assert error is None
        rows = [o for o in db.added if isinstance(o, RequirementProgress)]
        assert len({str(r.requirement_id) for r in rows}) == len(rows) == 2


class TestAddRequirementBackfill:
    """Adding a requirement to a program must backfill progress rows for
    in-progress enrollments, or the new requirement is never counted and a
    member can be/stay marked complete without it."""

    async def test_backfills_progress_for_active_enrollments(self):
        from app.models.training import RequirementProgress
        from app.schemas.training_program import ProgramRequirementCreate

        program = SimpleNamespace(id=str(uuid4()), organization_id="org-1")
        requirement = SimpleNamespace(id=str(uuid4()))
        e1, e2 = str(uuid4()), str(uuid4())

        db = RecordingSession(
            [
                _one(program),  # get_program_by_id
                _one(requirement),  # TrainingRequirement lookup
                _one(None),  # duplicate check
                MagicMock(all=MagicMock(return_value=[(e1,), (e2,)])),  # enrollments
                _scalars([]),  # none already track this requirement
            ]
        )
        svc = TrainingProgramService(db)
        svc._recalculate_enrollment_progress = AsyncMock()

        req_id = uuid4()
        data = ProgramRequirementCreate(
            program_id=uuid4(), requirement_id=req_id, is_required=True
        )
        result, error = await svc.add_requirement_to_program(data, uuid4())

        assert error is None
        progress_added = [o for o in db.added if isinstance(o, RequirementProgress)]
        assert {p.enrollment_id for p in progress_added} == {e1, e2}
        assert all(p.requirement_id == req_id for p in progress_added)
        # Each affected enrollment is recomputed so the new requirement counts.
        assert svc._recalculate_enrollment_progress.await_count == 2

    async def test_link_defaults_to_not_owning_the_requirement(self):
        """
        The endpoint always receives an id that already exists, so ownership is
        opt-in: unless the caller says it just created the requirement, the link
        must not put it up for deletion on unlink.
        """
        from app.models.training import ProgramRequirement
        from app.schemas.training_program import ProgramRequirementCreate

        program = SimpleNamespace(id=str(uuid4()), organization_id="org-1")
        db = RecordingSession(
            [
                _one(program),  # get_program_by_id
                _one(SimpleNamespace(id=str(uuid4()))),  # TrainingRequirement lookup
                _one(None),  # duplicate check
                MagicMock(all=MagicMock(return_value=[])),  # no enrollments
                _scalars([]),  # nothing already tracking it
            ]
        )
        svc = TrainingProgramService(db)
        svc._recalculate_enrollment_progress = AsyncMock()

        data = ProgramRequirementCreate(program_id=uuid4(), requirement_id=uuid4())
        _, error = await svc.add_requirement_to_program(data, uuid4())

        assert error is None
        links = [o for o in db.added if isinstance(o, ProgramRequirement)]
        assert len(links) == 1
        assert links[0].owns_requirement is False

    async def test_link_records_ownership_when_caller_created_it(self):
        from app.models.training import ProgramRequirement
        from app.schemas.training_program import ProgramRequirementCreate

        program = SimpleNamespace(id=str(uuid4()), organization_id="org-1")
        db = RecordingSession(
            [
                _one(program),
                _one(SimpleNamespace(id=str(uuid4()))),
                _one(None),
                MagicMock(all=MagicMock(return_value=[])),
            ]
        )
        svc = TrainingProgramService(db)
        svc._recalculate_enrollment_progress = AsyncMock()

        data = ProgramRequirementCreate(
            program_id=uuid4(), requirement_id=uuid4(), owns_requirement=True
        )
        _, error = await svc.add_requirement_to_program(data, uuid4())

        assert error is None
        links = [o for o in db.added if isinstance(o, ProgramRequirement)]
        assert links[0].owns_requirement is True


if __name__ == "__main__":  # pragma: no cover
    import pytest

    raise SystemExit(pytest.main([__file__, "-v"]))
