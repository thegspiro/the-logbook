"""Requirement credit is applied to the row as committed, under its lock.

``apply_requirement_credit`` and ``revoke_requirement_credit`` add to or take
from ``progress_value`` and write the result back. Computed from an unlocked
read, two credits to the same requirement at the same moment both start from
the same value and one is lost: two evaluations of different shifts submitted
together left a trainee at 4 transports where the ledger held 5 (Pitfall #27).

A session that has already loaded the row answers a plain query from its own
copy, so the read must also refresh it (``populate_existing``); the tests here
change the value behind the session's back, as another request's commit
would, and require the credit to build on it.
"""

import uuid

import pytest
from sqlalchemy import select, text

from app.models.training import (
    ProgressCreditSource,
    RequirementProgress,
    RequirementProgressCredit,
    RequirementType,
)
from app.services.training_program_service import TrainingProgramService
from tests.test_shift_evaluation_credit import _requirement
from tests.test_shift_evaluations import _scene

pytestmark = pytest.mark.integration


async def _committed_elsewhere(db, progress, value):
    """Another request's write: straight to the table, not through the
    session's copy of the row."""
    await db.execute(
        text("UPDATE requirement_progress SET progress_value = :v WHERE id = :id"),
        {"v": value, "id": progress.id},
    )


async def _value(db, progress_id) -> float:
    return float(
        (
            await db.execute(
                select(RequirementProgress.progress_value).where(
                    RequirementProgress.id == progress_id
                )
            )
        ).scalar_one()
        or 0
    )


class TestCreditBuildsOnTheCommittedValue:
    async def test_applying_adds_to_what_another_request_wrote(self, db_session):
        scene = await _scene(db_session)
        progress = await _requirement(
            db_session, scene, RequirementType.TRANSPORTS, required_transports=20
        )
        await _committed_elsewhere(db_session, progress, 3)

        _, error = await TrainingProgramService(db_session).apply_requirement_credit(
            progress_id=progress.id,
            organization_id=scene.org_id,
            source_type=ProgressCreditSource.SHIFT_EVALUATION,
            source_id=str(uuid.uuid4()),
            units=1,
        )

        assert error is None
        assert await _value(db_session, progress.id) == 4

    async def test_revoking_takes_from_what_another_request_wrote(self, db_session):
        scene = await _scene(db_session)
        progress = await _requirement(
            db_session, scene, RequirementType.TRANSPORTS, required_transports=20
        )
        service = TrainingProgramService(db_session)
        source = str(uuid.uuid4())
        await service.apply_requirement_credit(
            progress_id=progress.id,
            organization_id=scene.org_id,
            source_type=ProgressCreditSource.SHIFT_EVALUATION,
            source_id=source,
            units=2,
        )
        # Another evaluation's credit landed meanwhile: 2 + 5.
        await _committed_elsewhere(db_session, progress, 7)

        await service.revoke_requirement_credit(
            progress_id=progress.id,
            organization_id=scene.org_id,
            source_type=ProgressCreditSource.SHIFT_EVALUATION,
            source_id=source,
        )

        assert await _value(db_session, progress.id) == 5


class TestBothPathsLockTheRow:
    """Serializing the read-then-write: the row, and the ledger lookup, are
    locking reads in both paths."""

    async def _statements(self, db, run):
        recorded = []
        real_execute = db.execute

        async def recording(statement, *args, **kwargs):
            recorded.append(statement)
            return await real_execute(statement, *args, **kwargs)

        db.execute = recording
        try:
            await run()
        finally:
            del db.execute
        return recorded

    @staticmethod
    def _locked_reads_of(statements, table):
        return [
            s
            for s in statements
            if getattr(s, "_for_update_arg", None) is not None
            # The selected entity's table: on a joined query the final FROM
            # is the join, not the table.
            and table in s.columns_clause_froms
        ]

    async def test_apply_and_revoke_lock_the_row_and_the_ledger(self, db_session):
        scene = await _scene(db_session)
        progress = await _requirement(
            db_session, scene, RequirementType.TRANSPORTS, required_transports=20
        )
        service = TrainingProgramService(db_session)
        source = str(uuid.uuid4())

        applied = await self._statements(
            db_session,
            lambda: service.apply_requirement_credit(
                progress_id=progress.id,
                organization_id=scene.org_id,
                source_type=ProgressCreditSource.SHIFT_EVALUATION,
                source_id=source,
                units=1,
            ),
        )
        revoked = await self._statements(
            db_session,
            lambda: service.revoke_requirement_credit(
                progress_id=progress.id,
                organization_id=scene.org_id,
                source_type=ProgressCreditSource.SHIFT_EVALUATION,
                source_id=source,
            ),
        )

        for statements in (applied, revoked):
            assert self._locked_reads_of(statements, RequirementProgress.__table__)
            assert self._locked_reads_of(
                statements, RequirementProgressCredit.__table__
            )
