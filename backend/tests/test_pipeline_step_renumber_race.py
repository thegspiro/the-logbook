"""Two coordinators deleting different stages of one pipeline at once.

``delete_step`` closes the gap a deletion leaves by renumbering every survivor
to ``0..n-1``. That is a read-then-write over the step list, so it has the same
shape as ``add_step``'s ``sort_order`` allocation — and, before this change,
without ``add_step``'s row lock.

Under InnoDB's default REPEATABLE READ a plain ``SELECT`` answers from the
snapshot taken at the transaction's *first* read. So a coordinator whose
transaction is already open when another coordinator's deletion commits still
sees the deleted stage in ``pipeline.steps``. ``_renumber_steps_densely``
assigns a position to every step it is handed, unconditionally, so the flush
issues an ``UPDATE`` against a row that no longer exists; SQLAlchemy compares
the affected row count with what it expected and raises ``StaleDataError``,
rolling back a deletion that was perfectly valid. The coordinator sees a 500.

The pipeline-row lock ``add_step`` already took is necessary but *not*
sufficient, which is what these tests found: ``get_pipeline`` loads ``steps``
on a separate, non-locking SELECT, so the collection stays as stale as it ever
was and the deletion still fails. The fix is ``_load_steps_for_update`` — a
locking read of the step rows themselves, which ignores the snapshot, returns
latest committed state, and blocks a second writer until the first commits.
Both locks are taken in the same order everywhere (pipeline row, then steps),
so no two writers can deadlock against each other.

These tests use two REAL, independently-committing sessions. The savepoint
-based ``db_session`` fixture never truly commits, so it can never demonstrate
cross-transaction visibility. Everything created is torn down explicitly,
because these sessions really do write.
"""

import uuid

import pytest
from sqlalchemy import select

from app.core.database import database_manager
from app.models.membership_pipeline import (
    MembershipPipeline,
    MembershipPipelineStep,
    ProspectiveMember,
    ProspectStatus,
    ProspectStepProgress,
    StepProgressStatus,
)
from app.models.user import Organization
from app.services.membership_pipeline_service import MembershipPipelineService

pytestmark = pytest.mark.integration


@pytest.fixture
async def two_sessions(_initialize_database):
    """Two independent AsyncSessions, each its own real connection and
    transaction -- required to demonstrate cross-transaction visibility.
    """
    factory = database_manager.session_factory
    sessions = [factory(), factory()]
    try:
        yield sessions
    finally:
        for session in sessions:
            await session.rollback()
            await session.close()


async def _seed_pipeline(org_id: str, step_count: int):
    """Create an org, a pipeline and ``step_count`` stages, committed."""
    factory = database_manager.session_factory
    setup = factory()
    try:
        setup.add(Organization(name="Renumber Race VFD", slug=org_id))
        await setup.flush()
        org = (
            (
                await setup.execute(
                    select(Organization).where(Organization.slug == org_id)
                )
            )
            .scalars()
            .one()
        )

        svc = MembershipPipelineService(setup)
        pipeline = await svc.create_pipeline(
            organization_id=str(org.id), name="Renumber Race"
        )
        for i in range(step_count):
            await svc.add_step(
                pipeline.id,
                str(org.id),
                {
                    "name": f"Stage {i + 1}",
                    "step_type": "manual_approval",
                    "required": False,
                },
            )
        await setup.commit()
        return str(org.id), str(pipeline.id)
    finally:
        await setup.close()


async def _seed_prospect(org_id: str, pipeline_id: str, step_id: str) -> str:
    """A prospect parked on ``step_id``, committed."""
    factory = database_manager.session_factory
    setup = factory()
    try:
        prospect = ProspectiveMember(
            organization_id=org_id,
            pipeline_id=pipeline_id,
            current_step_id=step_id,
            first_name="Race",
            last_name="Prospect",
            email=f"race-{uuid.uuid4().hex[:10]}@example.com",
            status=ProspectStatus.ACTIVE,
        )
        setup.add(prospect)
        await setup.flush()
        setup.add(
            ProspectStepProgress(
                prospect_id=prospect.id,
                step_id=step_id,
                status=StepProgressStatus.IN_PROGRESS,
            )
        )
        await setup.commit()
        return str(prospect.id)
    finally:
        await setup.close()


async def _prospect_stage(prospect_id: str):
    """The prospect's current ``current_step_id``, freshly read."""
    factory = database_manager.session_factory
    reader = factory()
    try:
        return (
            await reader.execute(
                select(ProspectiveMember.current_step_id).where(
                    ProspectiveMember.id == prospect_id
                )
            )
        ).scalar_one()
    finally:
        await reader.close()


async def _progress_row_count(prospect_id: str, step_id: str) -> int:
    factory = database_manager.session_factory
    reader = factory()
    try:
        rows = (
            (
                await reader.execute(
                    select(ProspectStepProgress.id).where(
                        ProspectStepProgress.prospect_id == prospect_id,
                        ProspectStepProgress.step_id == step_id,
                    )
                )
            )
            .scalars()
            .all()
        )
        return len(rows)
    finally:
        await reader.close()


async def _teardown(org_id: str):
    factory = database_manager.session_factory
    cleanup = factory()
    try:
        prospect_ids = (
            (
                await cleanup.execute(
                    select(ProspectiveMember.id).where(
                        ProspectiveMember.organization_id == org_id
                    )
                )
            )
            .scalars()
            .all()
        )
        if prospect_ids:
            await cleanup.execute(
                ProspectStepProgress.__table__.delete().where(
                    ProspectStepProgress.prospect_id.in_(prospect_ids)
                )
            )
            await cleanup.execute(
                ProspectiveMember.__table__.delete().where(
                    ProspectiveMember.id.in_(prospect_ids)
                )
            )
        pipeline_ids = (
            (
                await cleanup.execute(
                    select(MembershipPipeline.id).where(
                        MembershipPipeline.organization_id == org_id
                    )
                )
            )
            .scalars()
            .all()
        )
        if pipeline_ids:
            await cleanup.execute(
                MembershipPipelineStep.__table__.delete().where(
                    MembershipPipelineStep.pipeline_id.in_(pipeline_ids)
                )
            )
        await cleanup.execute(
            MembershipPipeline.__table__.delete().where(
                MembershipPipeline.organization_id == org_id
            )
        )
        await cleanup.execute(
            Organization.__table__.delete().where(Organization.id == org_id)
        )
        await cleanup.commit()
    finally:
        await cleanup.close()


async def _positions(pipeline_id: str):
    """(name, sort_order) for a pipeline's stages, freshly read and ordered."""
    factory = database_manager.session_factory
    reader = factory()
    try:
        rows = (
            await reader.execute(
                select(
                    MembershipPipelineStep.name,
                    MembershipPipelineStep.sort_order,
                )
                .where(MembershipPipelineStep.pipeline_id == pipeline_id)
                .order_by(MembershipPipelineStep.sort_order)
            )
        ).all()
        return [(name, order) for name, order in rows]
    finally:
        await reader.close()


class TestConcurrentStageDeletesRenumberAgainstCommittedState:
    """The second deletion must renumber the stages that actually survive."""

    async def test_second_delete_does_not_renumber_a_stage_the_first_removed(
        self, two_sessions
    ):
        first, second = two_sessions
        slug = f"renumber-race-{uuid.uuid4().hex[:12]}"
        org_id, pipeline_id = await _seed_pipeline(slug, 4)

        try:
            steps = await _positions(pipeline_id)
            assert [order for _, order in steps] == [0, 1, 2, 3]

            step_rows = (
                (
                    await second.execute(
                        select(MembershipPipelineStep)
                        .where(MembershipPipelineStep.pipeline_id == pipeline_id)
                        .order_by(MembershipPipelineStep.sort_order)
                    )
                )
                .scalars()
                .all()
            )
            # This read is the point of the test: it pins the second
            # coordinator's REPEATABLE READ snapshot *before* the first
            # deletion commits, which is what a coordinator with the builder
            # already open has. Everything the second transaction reads
            # non-locking from here on is as of this moment.
            second_ids = [str(row.id) for row in step_rows]
            assert len(second_ids) == 4

            # First coordinator removes stage 2 and commits, in full.
            first_svc = MembershipPipelineService(first)
            assert (
                await first_svc.delete_step(second_ids[1], pipeline_id, org_id) is True
            )

            # Second coordinator now removes stage 3. Its own read of the step
            # list must see three stages, not the four its snapshot holds.
            second_svc = MembershipPipelineService(second)
            assert (
                await second_svc.delete_step(second_ids[2], pipeline_id, org_id) is True
            )

            surviving = await _positions(pipeline_id)
            assert [name for name, _ in surviving] == ["Stage 1", "Stage 4"]
            # Dense and gapless: the whole reason delete_step renumbers.
            assert [order for _, order in surviving] == [0, 1]
        finally:
            await first.rollback()
            await second.rollback()
            await _teardown(org_id)

    async def test_delete_then_reorder_sees_the_committed_step_set(self, two_sessions):
        """``reorder_steps`` validates its permutation against the step list it
        loaded. Read from a stale snapshot, it would demand the deleted stage
        be named and reject the coordinator's honest, current list."""
        first, second = two_sessions
        slug = f"reorder-race-{uuid.uuid4().hex[:12]}"
        org_id, pipeline_id = await _seed_pipeline(slug, 3)

        try:
            step_rows = (
                (
                    await second.execute(
                        select(MembershipPipelineStep)
                        .where(MembershipPipelineStep.pipeline_id == pipeline_id)
                        .order_by(MembershipPipelineStep.sort_order)
                    )
                )
                .scalars()
                .all()
            )
            ids = [str(row.id) for row in step_rows]

            first_svc = MembershipPipelineService(first)
            assert await first_svc.delete_step(ids[0], pipeline_id, org_id) is True

            # The surviving two, reversed. A stale read would insist on three.
            second_svc = MembershipPipelineService(second)
            reordered = await second_svc.reorder_steps(
                pipeline_id, org_id, [ids[2], ids[1]]
            )
            assert reordered is not None
            # reorder_steps flushes; the endpoint owns the commit.
            await second.commit()

            surviving = await _positions(pipeline_id)
            assert surviving == [("Stage 3", 0), ("Stage 2", 1)]
        finally:
            await first.rollback()
            await second.rollback()
            await _teardown(org_id)


class TestConcurrentStageDeletesCarryProspectsForward:
    """A prospect must never be left on no stage by a concurrent deletion.

    Locking the *steps* does nothing for the reads that follow: a locking read
    does not advance the transaction's read view, so the plain SELECTs below it
    still answer from the snapshot the transaction opened with. These cover the
    two ways that bit.
    """

    async def test_a_prospect_moved_by_the_first_delete_is_not_stranded(
        self, two_sessions
    ):
        """Delete adjacent stages at once, with a prospect between them.

        The first deletion moves the prospect from stage 1 onto stage 2. The
        second deletes stage 2. Read from a stale snapshot, that second call
        finds nobody on stage 2, deletes it anyway, and ON DELETE SET NULL
        clears current_step_id -- leaving the applicant on no stage and off
        every board that groups by one.
        """
        first, second = two_sessions
        slug = f"stranded-race-{uuid.uuid4().hex[:12]}"
        org_id, pipeline_id = await _seed_pipeline(slug, 3)

        try:
            step_rows = (
                (
                    await second.execute(
                        select(MembershipPipelineStep)
                        .where(MembershipPipelineStep.pipeline_id == pipeline_id)
                        .order_by(MembershipPipelineStep.sort_order)
                    )
                )
                .scalars()
                .all()
            )
            ids = [str(row.id) for row in step_rows]
            prospect_id = await _seed_prospect(org_id, pipeline_id, ids[0])

            # Pin the second coordinator's snapshot before anything commits.
            await second.execute(
                select(ProspectiveMember.id).where(
                    ProspectiveMember.organization_id == org_id
                )
            )

            # First coordinator deletes stage 1; the prospect moves to stage 2.
            first_svc = MembershipPipelineService(first)
            assert await first_svc.delete_step(ids[0], pipeline_id, org_id) is True
            assert await _prospect_stage(prospect_id) == ids[1]

            # Second coordinator deletes stage 2 and must carry them forward.
            second_svc = MembershipPipelineService(second)
            assert await second_svc.delete_step(ids[1], pipeline_id, org_id) is True

            assert await _prospect_stage(prospect_id) == ids[2]
        finally:
            await first.rollback()
            await second.rollback()
            await _teardown(org_id)

    async def test_the_progress_row_follows_them_to_the_new_stage(self, two_sessions):
        """Moving the pointer is only half of carrying a prospect forward.

        The stage they land on has to read as the one they are working, which
        means a ``prospect_step_progress`` row on it -- exactly one, since
        ``(prospect_id, step_id)`` is unique. A second deletion working from a
        stale snapshot strands the prospect instead, so no row is written at
        all and the progress track disagrees with the stage pointer.
        """
        first, second = two_sessions
        slug = f"progress-race-{uuid.uuid4().hex[:12]}"
        org_id, pipeline_id = await _seed_pipeline(slug, 3)

        try:
            step_rows = (
                (
                    await second.execute(
                        select(MembershipPipelineStep)
                        .where(MembershipPipelineStep.pipeline_id == pipeline_id)
                        .order_by(MembershipPipelineStep.sort_order)
                    )
                )
                .scalars()
                .all()
            )
            ids = [str(row.id) for row in step_rows]
            prospect_id = await _seed_prospect(org_id, pipeline_id, ids[0])

            await second.execute(
                select(ProspectStepProgress.id).where(
                    ProspectStepProgress.prospect_id == prospect_id
                )
            )

            first_svc = MembershipPipelineService(first)
            assert await first_svc.delete_step(ids[0], pipeline_id, org_id) is True
            assert await _progress_row_count(prospect_id, ids[1]) == 1

            second_svc = MembershipPipelineService(second)
            assert await second_svc.delete_step(ids[1], pipeline_id, org_id) is True

            assert await _progress_row_count(prospect_id, ids[2]) == 1
        finally:
            await first.rollback()
            await second.rollback()
            await _teardown(org_id)
