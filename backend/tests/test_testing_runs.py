"""Tests for named testing runs.

A run is one pass over the checklist. The rules that matter: the newest run is
the current one (so starting a run archives the previous by existing), a mark
always lands in the current run, an archived run keeps every mark it had, and
two administrators pressing "start a run" together get one run rather than two.
"""

import uuid

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
