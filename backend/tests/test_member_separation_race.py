"""Two officers separating the same member at once must not count service twice.

``change_member_status`` reads the member's status, then closes their service
stint (``record_separation``) -- for a member with no recorded stints, by
writing the stint from hire to today. Two requests arriving together both
read "active", both write that stint, and the member's credited service is
doubled (CLAUDE.md Pitfall #27).

The fix locks the member row with a locking read (so the request that waits
reads the status the first one committed and stops at the "already" check)
and reads the stints with a locking read too. These tests use two real,
independently committing sessions -- the savepoint ``db_session`` fixture
never commits, so it cannot show cross-transaction visibility -- and pin both
transactions' REPEATABLE READ snapshots before either request starts, so the
stale-snapshot interleaving is exercised rather than left to scheduling luck.

Retirement is the separation driven here: it runs the same status check and
``record_separation`` as a drop, without the property-return report a drop
also generates.
"""

import asyncio
import uuid
from datetime import date
from types import SimpleNamespace

import pytest
from fastapi import BackgroundTasks, HTTPException
from sqlalchemy import text
from sqlalchemy.dialects import mysql

from app.core.database import database_manager
from app.models.user import Organization, User, UserStatus
from app.services.member_service_history_service import MemberServiceHistoryService


async def _make_org_officer_member():
    async with database_manager.session_factory() as session:
        org = Organization(
            name="Separation Race Test VFD",
            slug=f"seprace-{uuid.uuid4().hex[:12]}",
            organization_type="fire_department",
            timezone="UTC",
        )
        session.add(org)
        await session.flush()
        people = []
        for name, hire in (("officer", date(2000, 1, 1)), ("member", date(2012, 1, 1))):
            username = f"{name}{uuid.uuid4().hex[:8]}"
            user = User(
                organization_id=org.id,
                username=username,
                email=f"{username}@seprace.test",
                first_name="Test",
                last_name=name.title(),
                password_hash="x",
                status=UserStatus.ACTIVE,
                hire_date=hire,
            )
            session.add(user)
            people.append(user)
        await session.commit()
        return org.id, people[0].id, people[1].id


async def _cleanup_org(org_id: str) -> None:
    async with database_manager.session_factory() as session:
        for table in ("member_service_periods", "users"):
            await session.execute(
                text(f"DELETE FROM {table} WHERE organization_id = :o"), {"o": org_id}
            )
        await session.execute(
            text("DELETE FROM organizations WHERE id = :o"), {"o": org_id}
        )
        await session.commit()


@pytest.mark.integration
@pytest.mark.usefixtures("_initialize_database")
class TestConcurrentSeparation:
    async def test_two_simultaneous_separations_write_one_stint(self):
        from app.api.v1.endpoints.member_status import (
            MemberStatusChangeRequest,
            change_member_status,
        )

        org_id, officer_id, member_id = await _make_org_officer_member()
        caller = SimpleNamespace(
            id=officer_id, organization_id=org_id, username="officer"
        )

        session_a = database_manager.session_factory()
        session_b = database_manager.session_factory()
        try:
            # Pin both snapshots, and put the member in both identity maps, the
            # way get_current_user's earlier reads would in a real request.
            for session in (session_a, session_b):
                await session.get(User, member_id)

            async def retire(session):
                try:
                    await change_member_status(
                        uuid.UUID(member_id),
                        MemberStatusChangeRequest(new_status="retired"),
                        BackgroundTasks(),
                        db=session,
                        current_user=caller,
                    )
                except HTTPException as exc:
                    await session.rollback()
                    return exc
                return None

            outcomes = await asyncio.gather(
                retire(session_a), retire(session_b), return_exceptions=True
            )

            for outcome in outcomes:
                assert not isinstance(outcome, BaseException) or isinstance(
                    outcome, HTTPException
                ), f"a request raised {outcome!r}"
            refused = [o for o in outcomes if isinstance(o, HTTPException)]
            assert len(refused) == 1, f"expected exactly one refusal, got {outcomes!r}"
            assert refused[0].status_code == 400
            assert "already retired" in refused[0].detail

            async with database_manager.session_factory() as check:
                rows = (
                    await check.execute(
                        text(
                            "SELECT start_date, end_date FROM member_service_periods "
                            "WHERE user_id = :u"
                        ),
                        {"u": member_id},
                    )
                ).all()
            assert len(rows) == 1, (
                "service was double-counted: two stints written for one "
                f"separation ({rows!r})"
            )
        finally:
            await session_a.rollback()
            await session_b.rollback()
            await session_a.close()
            await session_b.close()
            await _cleanup_org(org_id)


@pytest.mark.unit
class TestSeparationReadsLock:
    """Statement-level checks, so a regression is named even without MySQL."""

    async def test_record_separation_reads_the_stints_with_a_locking_read(self):
        statements = []

        class _Db:
            async def execute(self, stmt):
                statements.append(stmt)
                return SimpleNamespace(scalars=lambda: SimpleNamespace(all=lambda: []))

            def add(self, _obj):
                pass

        member = SimpleNamespace(
            id="m1", organization_id="o1", hire_date=date(2012, 1, 1)
        )
        await MemberServiceHistoryService(_Db()).record_separation(
            member, UserStatus.RETIRED, date(2026, 9, 30), None
        )

        [stmt] = statements
        sql = str(stmt.compile(dialect=mysql.dialect()))
        assert "FOR UPDATE" in sql
        assert stmt.get_execution_options().get("populate_existing") is True
