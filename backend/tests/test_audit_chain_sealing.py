"""SEC2-28-10: the audit hash chain is sealed apart from the audit write.

Audit rows are inserted unsealed in the caller's transaction; a sealer in its
own short transaction, serialized on the ``audit_chain_head`` row, assigns
each its chain position and hashes. Before this, every writer read the
chain's last row without a lock, so two concurrent writers linked to the same
row and forked the chain -- reported by ``verify_integrity`` as tampering.

The concurrency tests need real, independently committing sessions (a mocked
session cannot show two transactions racing, and the auto-rolled-back
``db_session`` cannot commit), so they clean up after themselves.
"""

import asyncio
import uuid

import pytest
from sqlalchemy import delete, func, select, text, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import audit as audit_module
from app.core.audit import audit_logger, seal_audit_chain
from app.core.database import database_manager
from app.models.audit import AuditChainHead, AuditLog

pytestmark = pytest.mark.integration


async def _write(db: AsyncSession, tag: str, i: int = 0) -> AuditLog:
    row = await audit_logger.create_log_entry(
        db,
        event_type=f"seal_test_{tag}_{i}",
        event_category="security",
        severity="info",
        event_data={"tag": tag, "i": i},
    )
    assert row is not None
    return row


async def _settle_background_sealer() -> None:
    """Let an after-commit sealer started by this test finish, so it cannot
    run into the next test's cleanup or assertions."""
    task = audit_module._seal_task
    if task is not None and not task.done():
        await task


async def _verify_fresh() -> dict:
    async with database_manager.session_factory() as db:
        return await audit_logger.verify_integrity(db)


@pytest.fixture
async def committed_ids():
    """Collect ids of rows a test commits, and remove them afterwards along
    with the chain head, which would otherwise point at a deleted tail."""
    ids: list[int] = []
    yield ids
    await _settle_background_sealer()
    async with database_manager.session_factory() as cleanup:
        if ids:
            await cleanup.execute(delete(AuditLog).where(AuditLog.id.in_(ids)))
        await cleanup.execute(delete(AuditChainHead))
        await cleanup.commit()


@pytest.mark.usefixtures("_initialize_database")
class TestConcurrentWritersDoNotFork:
    async def test_concurrent_writers_and_sealers_produce_one_chain(
        self, committed_ids
    ):
        """Eight writers commit at once on their own sessions -- the shape
        IPBlockingMiddleware produces for a burst from a blocked address --
        then two sealers run at once. Every row is sealed exactly once, at
        a distinct position, and the chain verifies."""
        tag = uuid.uuid4().hex[:8]

        async def writer(i: int) -> int:
            async with database_manager.session_factory() as db:
                row = await _write(db, tag, i)
                await db.commit()
                return row.id

        ids = await asyncio.gather(*(writer(i) for i in range(8)))
        committed_ids.extend(ids)

        sealed = await asyncio.gather(seal_audit_chain(), seal_audit_chain())
        await _settle_background_sealer()
        # Each row was sealed by exactly one of the sealers (or by the
        # after-commit sealer the commits requested), never twice.
        assert sum(sealed) <= len(ids)

        async with database_manager.session_factory() as db:
            rows = (
                (
                    await db.execute(
                        select(AuditLog)
                        .where(AuditLog.id.in_(ids))
                        .order_by(AuditLog.chain_seq)
                    )
                )
                .scalars()
                .all()
            )
            head = await db.get(AuditChainHead, 1)
        seqs = [row.chain_seq for row in rows]
        assert None not in seqs
        assert seqs == list(range(seqs[0], seqs[0] + len(ids)))
        # No two rows claim the same predecessor -- the fork the old code made.
        assert len({row.previous_hash for row in rows}) == len(rows)
        assert head is not None
        assert head.last_seq == seqs[-1]
        assert head.last_hash == rows[-1].current_hash

        result = await _verify_fresh()
        assert result["errors"] == []
        assert result["verified"] is True
        assert result["pending_seal"] == 0

    async def test_late_committer_is_sealed_after_higher_ids(self, committed_ids):
        """A transaction that inserts first and commits last holds the lower
        id but joins the chain later. The chain is walked by position, so it
        still verifies."""
        tag = uuid.uuid4().hex[:8]
        slow = database_manager.session_factory()
        try:
            early = await _write(slow, tag, 0)
            committed_ids.append(early.id)

            async with database_manager.session_factory() as fast:
                late = await _write(fast, tag, 1)
                await fast.commit()
            committed_ids.append(late.id)
            await seal_audit_chain()

            await slow.commit()
        finally:
            await slow.close()
        await seal_audit_chain()
        await _settle_background_sealer()

        async with database_manager.session_factory() as db:
            early_seq = (
                await db.execute(
                    select(AuditLog.chain_seq).where(AuditLog.id == early.id)
                )
            ).scalar()
            late_seq = (
                await db.execute(
                    select(AuditLog.chain_seq).where(AuditLog.id == late.id)
                )
            ).scalar()
        assert early.id < late.id
        assert late_seq is not None
        assert early_seq is not None
        assert early_seq > late_seq

        result = await _verify_fresh()
        assert result["errors"] == []
        assert result["verified"] is True

    async def test_after_commit_hook_seals_without_being_asked(self, committed_ids):
        """An ordinary commit asks for a seal in the background; nothing has
        to call the sealer for the row to join the chain."""
        async with database_manager.session_factory() as db:
            row = await _write(db, uuid.uuid4().hex[:8])
            await db.commit()
        committed_ids.append(row.id)

        assert audit_module._seal_task is not None
        await _settle_background_sealer()

        async with database_manager.session_factory() as db:
            sealed = (
                await db.execute(select(AuditLog).where(AuditLog.id == row.id))
            ).scalar_one()
        assert sealed.chain_seq is not None
        assert sealed.current_hash is not None


@pytest.mark.usefixtures("_initialize_database")
class TestRolledBackActionsNeverReachTheChain:
    async def test_rolled_back_audit_row_is_never_sealed(self, committed_ids):
        tag = uuid.uuid4().hex[:8]
        async with database_manager.session_factory() as db:
            await _write(db, tag)
            await db.rollback()

        await seal_audit_chain()
        await _settle_background_sealer()

        async with database_manager.session_factory() as db:
            count = (
                await db.execute(
                    select(func.count())
                    .select_from(AuditLog)
                    .where(AuditLog.event_type == f"seal_test_{tag}_0")
                )
            ).scalar()
        assert count == 0


class TestUnsealedRowsAreNotTampering:
    async def test_pending_rows_are_counted_not_reported(self, db_session):
        tag = uuid.uuid4().hex[:8]
        for i in range(2):
            await _write(db_session, tag, i)
        await audit_logger.seal_pending(db_session)
        for i in range(2, 5):
            await _write(db_session, tag, i)

        result = await audit_logger.verify_integrity(db_session)

        assert result["errors"] == []
        assert result["verified"] is True
        assert result["pending_seal"] >= 3

    async def test_tampering_with_a_sealed_row_is_still_detected(self, db_session):
        tag = uuid.uuid4().hex[:8]
        rows = [await _write(db_session, tag, i) for i in range(3)]
        await audit_logger.seal_pending(db_session)
        await _write(db_session, tag, 3)  # pending, must not mask the tamper

        target_id = rows[1].id
        await db_session.execute(
            update(AuditLog).where(AuditLog.id == target_id).values(severity="critical")
        )
        db_session.expire_all()

        result = await audit_logger.verify_integrity(db_session)

        assert result["verified"] is False
        assert any(e["log_id"] == target_id for e in result["errors"])

    async def test_a_sealed_row_cannot_be_sealed_twice(self, db_session):
        row = await _write(db_session, uuid.uuid4().hex[:8])
        assert await audit_logger.seal_pending(db_session) >= 1
        row_id, sealed_hash = row.id, row.current_hash

        assert await audit_logger.seal_pending(db_session) == 0
        db_session.expire_all()
        reread = (
            await db_session.execute(select(AuditLog).where(AuditLog.id == row_id))
        ).scalar_one()
        assert reread.current_hash == sealed_hash


class TestRetentionBoundaryMustBeAChainPrefix:
    async def test_boundary_inside_the_chain_is_refused(self, db_session):
        tag = uuid.uuid4().hex[:8]
        rows = [await _write(db_session, tag, i) for i in range(3)]
        await audit_logger.seal_pending(db_session)
        assert await audit_logger._is_chain_prefix(db_session, rows[1].id)

        # Reproduce a late committer: the row with the middle id holds the
        # last chain position, so an id boundary at rows[1] cuts the chain.
        a, b = rows[1].chain_seq, rows[2].chain_seq
        await db_session.execute(
            text("UPDATE audit_logs SET chain_seq = -1 WHERE id = :id"),
            {"id": rows[1].id},
        )
        await db_session.execute(
            text("UPDATE audit_logs SET chain_seq = :s WHERE id = :id"),
            {"s": a, "id": rows[2].id},
        )
        await db_session.execute(
            text("UPDATE audit_logs SET chain_seq = :s WHERE id = :id"),
            {"s": b, "id": rows[1].id},
        )
        assert not await audit_logger._is_chain_prefix(db_session, rows[1].id)

    async def test_unsealed_row_below_the_boundary_is_refused(self, db_session):
        tag = uuid.uuid4().hex[:8]
        row = await _write(db_session, tag)
        assert not await audit_logger._is_chain_prefix(db_session, row.id)
