"""Tests for named testing runs.

A run is one pass over the checklist. The rules that matter: the newest run is
the current one (so starting a run archives the previous by existing), a mark
always lands in the current run, an archived run keeps every mark it had, and
two administrators pressing "start a run" together get one run rather than two.
"""

import uuid
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import selectinload

from app.models.testing_checklist import TestingCheckStatus as CheckStatus
from app.models.testing_checklist import TestingRun as Run
from app.models.user import Organization, User
from app.schemas.testing_checklist import TestingCheckUpsert as CheckUpsert
from app.services.testing_checklist_service import (
    TestingChecklistService as ChecklistService,
)

pytestmark = pytest.mark.integration


async def _make_org(db, label="Runs FD"):
    org = Organization(name=label, slug=f"runs-{uuid.uuid4().hex[:8]}")
    db.add(org)
    await db.flush()
    return org


async def _make_user(db, org):
    suffix = uuid.uuid4().hex[:8]
    user = User(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        username=f"tester-{suffix}",
        email=f"tester-{suffix}@example.org",
        first_name="Fire",
        last_name="Fighter",
    )
    db.add(user)
    await db.flush()
    result = await db.execute(
        select(User).where(User.id == user.id).options(selectinload(User.positions))
    )
    return result.scalar_one()


def _mark(path="/events", status=CheckStatus.PASS, **kwargs):
    return CheckUpsert(route_path=path, status=status, **kwargs)


class TestRunLifecycle:
    async def test_the_first_mark_opens_a_run(self, db_session):
        org = await _make_org(db_session)
        user = await _make_user(db_session, org)
        service = ChecklistService(db_session)

        assert await service.current_run(org.id) is None
        entry = await service.upsert_entry(org.id, user, _mark())

        run = await service.current_run(org.id)
        assert run is not None
        assert entry.run_id == run.id
        assert run.label.startswith("Run of ")

    async def test_the_newest_run_is_the_current_one(self, db_session):
        org = await _make_org(db_session)
        service = ChecklistService(db_session)

        await service.start_run(org.id, "First pass")
        second = await service.start_run(org.id, "Second pass")

        current = await service.current_run(org.id)
        assert current is not None
        assert current.id == second.id
        assert [run.label for run in await service.list_runs(org.id)] == [
            "Second pass",
            "First pass",
        ]

    async def test_starting_a_run_keeps_the_previous_run_intact(self, db_session):
        org = await _make_org(db_session)
        user = await _make_user(db_session, org)
        service = ChecklistService(db_session)
        await service.upsert_entry(org.id, user, _mark(status=CheckStatus.FAIL))
        first = await service.current_run(org.id)
        assert first is not None

        await service.start_run(org.id, "Second pass", started_by=user)

        # The new run starts empty...
        current = await service.current_run(org.id)
        assert current is not None
        assert (
            await service.list_entries(org.id, str(user.id), run_id=current.id)
        ) == []
        # ...and the old one still holds what it held.
        archived = await service.list_entries(org.id, str(user.id), run_id=first.id)
        assert [entry.status for entry in archived] == [CheckStatus.FAIL]

    async def test_a_page_can_be_re_tested_in_the_next_run(self, db_session):
        # The unique index is per run, so this is two observations, not an
        # overwrite of the first.
        org = await _make_org(db_session)
        user = await _make_user(db_session, org)
        service = ChecklistService(db_session)
        await service.upsert_entry(org.id, user, _mark(status=CheckStatus.FAIL))
        first = await service.current_run(org.id)
        await service.start_run(org.id, "Second pass")
        await service.upsert_entry(org.id, user, _mark(status=CheckStatus.PASS))

        assert first is not None
        old = await service.list_entries(org.id, str(user.id), run_id=first.id)
        current = await service.current_run(org.id)
        assert current is not None
        new = await service.list_entries(org.id, str(user.id), run_id=current.id)
        assert [entry.status for entry in old] == [CheckStatus.FAIL]
        assert [entry.status for entry in new] == [CheckStatus.PASS]

    async def test_re_marking_within_a_run_still_replaces(self, db_session):
        org = await _make_org(db_session)
        user = await _make_user(db_session, org)
        service = ChecklistService(db_session)

        await service.upsert_entry(org.id, user, _mark(status=CheckStatus.FAIL))
        await service.upsert_entry(org.id, user, _mark(status=CheckStatus.PASS))

        run = await service.current_run(org.id)
        assert run is not None
        entries = await service.list_entries(org.id, str(user.id), run_id=run.id)
        assert len(entries) == 1
        assert entries[0].status == CheckStatus.PASS

    async def test_clearing_leaves_earlier_runs_alone(self, db_session):
        org = await _make_org(db_session)
        user = await _make_user(db_session, org)
        service = ChecklistService(db_session)
        await service.upsert_entry(org.id, user, _mark())
        first = await service.current_run(org.id)
        await service.start_run(org.id, "Second pass")
        await service.upsert_entry(org.id, user, _mark(path="/training"))
        current = await service.current_run(org.id)
        assert current is not None

        deleted = await service.clear_run(org.id, str(user.id), run_id=current.id)

        assert deleted == 1
        assert first is not None
        assert (
            len(await service.list_entries(org.id, str(user.id), run_id=first.id)) == 1
        )

    async def test_never_reads_another_department_by_run_id(self, db_session):
        org_a = await _make_org(db_session, "A FD")
        org_b = await _make_org(db_session, "B FD")
        service = ChecklistService(db_session)
        run_b = await service.start_run(org_b.id, "B's run")

        assert await service.get_run(org_a.id, run_b.id) is None
        assert await service.get_run(org_b.id, run_b.id) is not None

    async def test_records_the_build_and_the_expectation(self, db_session):
        org = await _make_org(db_session)
        user = await _make_user(db_session, org)
        service = ChecklistService(db_session)

        entry = await service.upsert_entry(
            org.id,
            user,
            _mark(
                status=CheckStatus.BLOCKED,
                build_id="3f9a2c14e8b7",
                expected_access="denied",
            ),
        )

        assert entry.build_id == "3f9a2c14e8b7"
        assert entry.expected_access.value == "denied"

    async def test_caps_the_runs_one_department_can_open(self, db_session, monkeypatch):
        org = await _make_org(db_session)
        service = ChecklistService(db_session)
        monkeypatch.setattr(
            "app.services.testing_checklist_service.MAX_RUNS_PER_ORGANIZATION", 2
        )

        await service.start_run(org.id, "One")
        await service.start_run(org.id, "Two")

        with pytest.raises(ValueError, match="maximum number of testing runs"):
            await service.start_run(org.id, "Three")


class TestConcurrentWrites:
    """Two saves landing together must not cost a tester their mark."""

    async def test_a_duplicate_insert_becomes_an_update(self):
        """The losing request recovers instead of reporting a failed save.

        Driven against a stub session rather than the database: the recovery
        turns on `rollback()`, and the db_session fixture nests every test in
        one transaction, so a real rollback would unwind the winning row this
        test had to plant. What is under test is the control flow — insert,
        refuse, rollback, re-read, update — not MySQL's constraint, which the
        re-marking tests above already exercise.
        """
        existing = SimpleNamespace(
            status=CheckStatus.FAIL,
            note=None,
            params=None,
            tested_as=None,
            build_id=None,
            expected_access=None,
            checked_at=None,
        )
        db = MagicMock()
        db.add = MagicMock()
        db.expunge = MagicMock()
        db.__contains__ = MagicMock(return_value=False)
        db.commit = AsyncMock(
            side_effect=[IntegrityError("insert", {}, Exception("duplicate")), None]
        )
        db.rollback = AsyncMock()
        db.refresh = AsyncMock()

        service = ChecklistService(db)
        service._run_for_writing = AsyncMock(return_value=SimpleNamespace(id="run-1"))
        service._positions_of = AsyncMock(return_value=["Firefighter"])
        service.list_entries = AsyncMock(return_value=[])
        # Nothing there on the first read; the winner's row on the second.
        service._find_entry = AsyncMock(side_effect=[None, existing])

        entry = await service.upsert_entry(
            "org-1", SimpleNamespace(id="u1"), _mark(status=CheckStatus.PASS)
        )

        assert entry is existing
        assert existing.status == CheckStatus.PASS
        assert db.rollback.await_count == 1
        assert db.commit.await_count == 2

    async def test_the_implicit_first_run_is_decided_under_the_lock(self, db_session):
        # `_run_for_writing` checks for a run before taking the lock; the
        # re-check inside it is what stops two first marks opening two runs.
        org = await _make_org(db_session)
        user = await _make_user(db_session, org)
        service = ChecklistService(db_session)
        existing = await service.start_run(org.id, "Already open")

        reused = await service.start_run(
            org.id, "Would be second", started_by=user, reuse_existing=True
        )

        assert reused.id == existing.id
        assert len(await service.list_runs(org.id)) == 1


class TestDepartedTesters:
    async def test_a_hard_deleted_tester_leaves_the_evidence_behind(self, db_session):
        """An archived run is the record of what was found then.

        Deleting the account that made a mark releases the attribution — the
        way `release_user_references` releases every other nullable owner — but
        must not rewrite the run. `tested_as` still says which seat found it.
        """
        org = await _make_org(db_session)
        user = await _make_user(db_session, org)
        service = ChecklistService(db_session)
        await service.upsert_entry(org.id, user, _mark(status=CheckStatus.FAIL))
        run = await service.current_run(org.id)
        assert run is not None

        await db_session.delete(user)
        await db_session.flush()

        entries = await service.list_entries(
            org.id, "nobody", include_all_testers=True, run_id=run.id
        )
        assert len(entries) == 1
        assert entries[0].user_id is None
        assert entries[0].status == CheckStatus.FAIL
        # The snapshot is whatever the account held; the point is that it is
        # still there once the account is not.
        assert entries[0].tested_as is not None


class TestOneRunAtATime:
    """Two administrators pressing "start a run" together must get one run.

    The service serializes the decision on the organization row and allocates
    the next sequence from a locking read (CLAUDE.md pitfall #27) — but a lock
    held by a service is only as good as what the database refuses, so the
    invariant is pinned where it is actually enforced. A concurrency test
    against one session would prove nothing here: an AsyncSession is not safe
    to share between coroutines, which is a different failure than the one
    being guarded.
    """

    async def test_sequences_increment(self, db_session):
        org = await _make_org(db_session)
        service = ChecklistService(db_session)

        first = await service.start_run(org.id, "One")
        second = await service.start_run(org.id, "Two")

        assert (first.sequence, second.sequence) == (1, 2)

    async def test_two_runs_may_not_share_a_number(self, db_session):
        org = await _make_org(db_session)
        service = ChecklistService(db_session)
        await service.start_run(org.id, "One")

        db_session.add(
            Run(organization_id=org.id, sequence=1, label="Racing duplicate")
        )
        with pytest.raises(IntegrityError):
            await db_session.flush()
        await db_session.rollback()

    async def test_each_department_numbers_its_own_runs(self, db_session):
        org_a = await _make_org(db_session, "A FD")
        org_b = await _make_org(db_session, "B FD")
        service = ChecklistService(db_session)

        run_a = await service.start_run(org_a.id, "A's first")
        run_b = await service.start_run(org_b.id, "B's first")

        assert run_a.sequence == run_b.sequence == 1
