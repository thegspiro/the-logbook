"""Security review (EC-14, pass 5): two officers filing a shift-completion
report for the same trainee on the same shift at once can both pass
``create_report``'s own duplicate guard and both attempt to commit a row.

``create_report``'s duplicate check ("A report already exists for this
trainee on this shift") read ``ShiftCompletionReport`` with a plain SELECT,
and the ``Shift`` row it validates against was also a plain SELECT — neither
locked anything (CLAUDE.md pitfall #27). Two concurrent ``create_report``
calls for the same ``shift_id`` + ``trainee_id`` both see zero existing
reports and both attempt the insert.

This does **not** produce a duplicate row: ``uq_shift_report_shift_trainee``
(a DB-level ``UniqueConstraint`` on ``shift_id`` + ``trainee_id``) already
stops that. What it produces instead is worse for the loser of the race than
the intended behavior: the losing transaction hits the constraint as a raw,
uncaught ``IntegrityError`` — an unhandled 500 with everything that implies
(no clean message, a raw SQL exception logged as an unhandled error) —
instead of this method's own clean, caught ``ValueError`` ("already exists"),
which the endpoint layer turns into an ordinary 400.

Fixed by matching ``submit_check``'s own established idiom for this exact
class of race (``equipment_check_service.py``): the DB unique constraint is
the actual concurrency authority, and the pre-insert ``SELECT`` is only a
friendly fast path. The insert now runs inside a SAVEPOINT
(``self.db.begin_nested()``, not ``submit_check``'s plain
``self.db.rollback()`` — this method is also called in a loop with
``commit=False`` by ``batch_create_reports``, and a full rollback there would
discard every other crew member's pending insert from earlier in the same
loop), and the ``IntegrityError`` out of it triggers a re-check for the
now-existing row. That re-check must itself be a locking read
(``.with_for_update()``): a SAVEPOINT rollback, unlike a full
``self.db.rollback()``, does not give the transaction a fresh REPEATABLE READ
snapshot, so a plain SELECT here would still see zero rows — the identical
staleness trap ``test_capacity_locking.py`` and
``test_call_type_deletion_race.py`` document — and misreport the winner's
now-committed row as an unrelated integrity failure.

Uses two REAL, independently-committing sessions, not the savepoint-based
``db_session`` fixture, which never truly commits and so can never
demonstrate cross-transaction visibility — same reasoning
``test_call_type_deletion_race.py`` documents for the identical shape.
"""

import asyncio
import uuid
from datetime import date, datetime, timedelta, timezone

import pytest
from sqlalchemy import text

from app.core.database import database_manager
from app.models.training import Shift, ShiftAttendance
from app.models.user import Organization, User
from app.services.shift_completion_service import ShiftCompletionService

pytestmark = pytest.mark.integration


async def _make_org_shift_and_crew(slug: str):
    async with database_manager.session_factory() as session:
        org = Organization(
            name="Duplicate Report Race Test FD",
            slug=slug,
            organization_type="fire_department",
        )
        session.add(org)
        await session.flush()

        officer = User(
            organization_id=org.id,
            username=f"officer-{uuid.uuid4().hex[:8]}",
            email=f"officer-{uuid.uuid4().hex[:8]}@test.com",
            first_name="Cap",
            last_name="Tain",
            password_hash="hashed",
        )
        trainee = User(
            organization_id=org.id,
            username=f"trainee-{uuid.uuid4().hex[:8]}",
            email=f"trainee-{uuid.uuid4().hex[:8]}@test.com",
            first_name="Pro",
            last_name="Bie",
            password_hash="hashed",
        )
        session.add_all([officer, trainee])
        await session.flush()

        shift_date = date(2026, 8, 20)
        start = datetime(2026, 8, 20, 8, 0, tzinfo=timezone.utc)
        shift = Shift(
            organization_id=org.id,
            shift_date=shift_date,
            start_time=start,
            end_time=start + timedelta(hours=12),
        )
        session.add(shift)
        await session.flush()

        # Crew membership create_report's own attendance/assignment check
        # requires, set up in advance so both concurrent calls take the same
        # path this finding is about — the duplicate-report race, not the
        # crew-membership one.
        session.add(ShiftAttendance(shift_id=shift.id, user_id=trainee.id))
        await session.commit()

        return org.id, officer.id, trainee.id, shift.id, shift_date


async def _cleanup_org(org_id: str) -> None:
    async with database_manager.session_factory() as session:
        await session.execute(
            text("DELETE FROM shift_completion_reports WHERE organization_id = :o"),
            {"o": org_id},
        )
        await session.execute(
            text(
                "DELETE FROM shift_attendance WHERE shift_id IN "
                "(SELECT id FROM shifts WHERE organization_id = :o)"
            ),
            {"o": org_id},
        )
        await session.execute(
            text("DELETE FROM shifts WHERE organization_id = :o"), {"o": org_id}
        )
        await session.execute(
            text("DELETE FROM users WHERE organization_id = :o"), {"o": org_id}
        )
        await session.execute(
            text("DELETE FROM organizations WHERE id = :o"), {"o": org_id}
        )
        await session.commit()


@pytest.mark.usefixtures("_initialize_database")
class TestDuplicateShiftReportRace:
    async def test_two_concurrent_creates_for_the_same_trainee_cannot_both_succeed(
        self,
    ):
        """Winner-agnostic: whichever request the database happens to
        serialize first, the other must lose *cleanly*, with the existing
        "already exists" ``ValueError`` — not with the raw ``IntegrityError``
        the DB-level unique constraint raises when the race isn't guarded.
        A second stored row for the same trainee on the same shift is
        asserted against too, though that half is already guaranteed by
        ``uq_shift_report_shift_trainee`` regardless of this fix.
        """
        org_id, officer_id, trainee_id, shift_id, shift_date = (
            await _make_org_shift_and_crew(f"duprace-{uuid.uuid4().hex[:12]}")
        )

        session_a = database_manager.session_factory()
        session_b = database_manager.session_factory()
        try:
            # Pin both transactions' REPEATABLE READ snapshot before either
            # coroutine's real work starts — see module docstring for why a
            # throwaway read that actually touches InnoDB is required here.
            pin = text("SELECT id FROM shifts WHERE id = :s")
            await session_a.execute(pin, {"s": shift_id})
            await session_b.execute(pin, {"s": shift_id})

            async def create_in(session):
                svc = ShiftCompletionService(session)
                try:
                    report = await svc.create_report(
                        organization_id=uuid.UUID(org_id),
                        officer_id=uuid.UUID(officer_id),
                        trainee_id=trainee_id,
                        shift_date=shift_date,
                        hours_on_shift=12.0,
                        shift_id=shift_id,
                    )
                    return report.id, None
                except Exception as e:
                    # Broad on purpose: the pre-fix code lets the loser reach
                    # an unhandled `IntegrityError` from the DB-level unique
                    # constraint instead of the intended, caught `ValueError`
                    # — itself part of what this fix corrects — so a narrower
                    # `except ValueError` here would leave that failure mode
                    # as a confusing harness-level crash instead of a clear
                    # assertion below.
                    await session.rollback()
                    return None, f"{type(e).__name__}: {e}"

            result_a, result_b = await asyncio.gather(
                create_in(session_a), create_in(session_b)
            )

            for label, outcome in (("a", result_a), ("b", result_b)):
                assert isinstance(outcome, tuple), f"{label} raised unexpectedly"

            succeeded = [r for r in (result_a, result_b) if r[0] is not None]
            failed = [r for r in (result_a, result_b) if r[1] is not None]

            assert len(succeeded) == 1, (
                "expected exactly one create to succeed, got "
                f"{result_a!r}, {result_b!r}"
            )
            assert len(failed) == 1, (
                "expected exactly one create to fail, got "
                f"{result_a!r}, {result_b!r}"
            )
            assert "already exists" in failed[0][1], (
                "expected the loser to fail with the duplicate-report "
                f"error, got {result_a!r}, {result_b!r}"
            )

            async with database_manager.session_factory() as check:
                count = (
                    await check.execute(
                        text(
                            "SELECT COUNT(*) FROM shift_completion_reports "
                            "WHERE shift_id = :s AND trainee_id = :t"
                        ),
                        {"s": shift_id, "t": trainee_id},
                    )
                ).scalar_one()
            assert count == 1, (
                f"duplicate reproduced: {count} reports exist for the same "
                "trainee on the same shift"
            )
        finally:
            await session_a.rollback()
            await session_b.rollback()
            await session_a.close()
            await session_b.close()
            await _cleanup_org(org_id)
