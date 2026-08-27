"""
Testing checklist service

Reads and writes the per-tester marks behind the in-app testing home.

Every query is scoped to the caller's organization (pitfall #14a) — the row id
never reaches this layer from a client, but the user id in a shared-run read
does, and one department's testing notes are not another's to read.
"""

from datetime import datetime, timezone
from typing import Collection, Optional, Sequence

from sqlalchemy import delete
from sqlalchemy import inspect as sa_inspect
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.testing_checklist import (
    TestingChecklistEntry,
    TestingCheckStatus,
    TestingRun,
)
from app.models.user import Organization, Position, User, user_positions
from app.schemas.testing_checklist import TestingCheckUpsert

# A run covers the pages the router declares — a few hundred. The cap is well
# clear of that and exists so a scripted client cannot grow the table without
# bound (pitfall #9); it is per tester, so one person's junk cannot stop
# another recording a real result.
MAX_ENTRIES_PER_USER = 600

# Runs are started by hand, one per pass over the app. The cap keeps a scripted
# client from filling the table and, with it, the history picker.
MAX_RUNS_PER_ORGANIZATION = 200


class TestingChecklistService:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def current_run(self, organization_id: str) -> Optional[TestingRun]:
        """The newest run, which is what "the current run" means here.

        No active flag: starting a run archives the previous one by existing.
        Ordered by ``sequence`` rather than by time — MySQL DATETIME keeps
        whole seconds, so two runs opened in the same second would tie and the
        answer would depend on the tie-break.
        """
        result = await self.db.execute(
            select(TestingRun)
            .where(TestingRun.organization_id == organization_id)
            .order_by(TestingRun.sequence.desc())
            .limit(1)
        )
        return result.scalar_one_or_none()

    async def get_run(self, organization_id: str, run_id: str) -> Optional[TestingRun]:
        """One run of this department's, by id — org-scoped (pitfall #14a)."""
        result = await self.db.execute(
            select(TestingRun).where(
                TestingRun.id == run_id,
                TestingRun.organization_id == organization_id,
            )
        )
        return result.scalar_one_or_none()

    async def list_runs(self, organization_id: str) -> list[TestingRun]:
        """Every run, newest first — the history picker."""
        result = await self.db.execute(
            select(TestingRun)
            .where(TestingRun.organization_id == organization_id)
            .order_by(TestingRun.sequence.desc())
        )
        return list(result.scalars().all())

    async def start_run(
        self,
        organization_id: str,
        label: str,
        started_by: Optional[User] = None,
        build_id: Optional[str] = None,
    ) -> TestingRun:
        """Open a new run, which retires the previous one by being newer.

        The organization row is locked for the decision: "is there already a
        run started this instant" is a read followed by a write, and two
        administrators pressing the button together would otherwise open two
        runs, leaving marks split across a pair nobody meant to have
        (CLAUDE.md pitfall #27). The count that enforces the cap is a locking
        read for the same reason — under REPEATABLE READ a plain count answers
        from the snapshot taken before the lock was acquired.
        """
        await self.db.execute(
            select(Organization.id)
            .where(Organization.id == organization_id)
            .with_for_update()
        )
        # A locking read, not a plain one: under REPEATABLE READ a plain SELECT
        # answers from the snapshot taken at the transaction's first read,
        # which predates the lock — so the count, and the next sequence number,
        # would both be stale exactly when it matters.
        existing = (
            (
                await self.db.execute(
                    select(TestingRun.sequence)
                    .where(TestingRun.organization_id == organization_id)
                    .with_for_update()
                )
            )
            .scalars()
            .all()
        )
        if len(existing) >= MAX_RUNS_PER_ORGANIZATION:
            raise ValueError(
                "This department already has the maximum number of testing runs"
            )

        run = TestingRun(
            organization_id=organization_id,
            sequence=(max(existing) if existing else 0) + 1,
            label=label,
            build_id=build_id,
            started_by_id=str(started_by.id) if started_by is not None else None,
            started_at=datetime.now(timezone.utc),
        )
        self.db.add(run)
        await self.db.commit()
        await self.db.refresh(run)
        return run

    async def _run_for_writing(
        self, organization_id: str, user: User, build_id: Optional[str]
    ) -> TestingRun:
        """The run a mark lands in, opening the first one if there is none.

        A department should not have to press "start a run" before it can
        record anything — the first mark is what says a run has begun.
        """
        run = await self.current_run(organization_id)
        if run is not None:
            return run
        label = f"Run of {datetime.now(timezone.utc).date().isoformat()}"
        if build_id:
            label = f"{label} · build {build_id[:8]}"
        return await self.start_run(
            organization_id, label, started_by=user, build_id=build_id
        )

    async def list_entries(
        self,
        organization_id: str,
        user_id: str,
        include_all_testers: bool = False,
        run_id: Optional[str] = None,
    ) -> list[TestingChecklistEntry]:
        """The caller's own marks in one run, or every tester's."""
        query = select(TestingChecklistEntry).where(
            TestingChecklistEntry.organization_id == organization_id
        )
        if run_id is not None:
            query = query.where(TestingChecklistEntry.run_id == run_id)
        if not include_all_testers:
            query = query.where(TestingChecklistEntry.user_id == user_id)
        result = await self.db.execute(
            query.order_by(
                TestingChecklistEntry.route_path,
                TestingChecklistEntry.updated_at.desc(),
            )
        )
        return list(result.scalars().all())

    async def resolve_user_names(
        self, organization_id: str, user_ids: Collection[str]
    ) -> dict[str, str]:
        """Names for a set of accounts, batched and org-scoped.

        A truncated UUID identifies nobody, and the whole point of the shared
        run is knowing which seat produced a result. Org-scoped because the ids
        reach this query from stored rows (pitfall #14a).
        """
        wanted = {uid for uid in user_ids if uid}
        if not wanted:
            return {}
        result = await self.db.execute(
            select(User.id, User.first_name, User.last_name, User.username).where(
                User.id.in_(wanted),
                User.organization_id == organization_id,
            )
        )
        return {
            str(user_id): f"{first or ''} {last or ''}".strip() or username
            for user_id, first, last, username in result.all()
        }

    async def resolve_tester_names(
        self, organization_id: str, entries: Sequence[TestingChecklistEntry]
    ) -> dict[str, str]:
        """Names for the accounts that made these marks."""
        return await self.resolve_user_names(
            organization_id, {entry.user_id for entry in entries}
        )

    async def upsert_entry(
        self,
        organization_id: str,
        user: User,
        payload: TestingCheckUpsert,
    ) -> TestingChecklistEntry:
        """Record one tester's finding on one page, replacing their previous one.

        Always lands in the **current** run: an archived run is the record of
        what was found then, and a mark made today does not belong in it.
        """
        run = await self._run_for_writing(organization_id, user, payload.build_id)

        result = await self.db.execute(
            select(TestingChecklistEntry).where(
                TestingChecklistEntry.organization_id == organization_id,
                TestingChecklistEntry.run_id == run.id,
                TestingChecklistEntry.user_id == user.id,
                TestingChecklistEntry.route_path == payload.route_path,
            )
        )
        entry = result.scalar_one_or_none()

        if entry is None:
            count = len(
                await self.list_entries(organization_id, str(user.id), run_id=run.id)
            )
            if count >= MAX_ENTRIES_PER_USER:
                raise ValueError(
                    "This testing run already covers the maximum number of pages"
                )
            entry = TestingChecklistEntry(
                organization_id=organization_id,
                run_id=run.id,
                user_id=str(user.id),
                route_path=payload.route_path,
            )
            self.db.add(entry)

        entry.status = payload.status
        entry.build_id = payload.build_id
        entry.expected_access = payload.expected_access
        # Sent on every save, so an explicit clear has to persist as one: the
        # note field is the whole record of what went wrong, and a "leave it
        # alone" reading of a blank would make a correction impossible to save
        # (pitfall #1, update side).
        entry.note = payload.note
        entry.params = payload.params
        entry.tested_as = await self._positions_of(user)
        entry.checked_at = (
            None
            if payload.status == TestingCheckStatus.UNTESTED
            else datetime.now(timezone.utc)
        )

        await self.db.commit()
        await self.db.refresh(entry)
        return entry

    async def clear_run(
        self,
        organization_id: str,
        user_id: Optional[str],
        run_id: Optional[str] = None,
    ) -> int:
        """Delete one tester's marks in a run, or the whole department's.

        ``user_id=None`` clears every tester — reserved for the caller who can
        already read every tester, and audited by the endpoint. Scoped to the
        current run unless told otherwise: clearing is for correcting the pass
        in progress, not for erasing what an earlier one found.
        """
        query = delete(TestingChecklistEntry).where(
            TestingChecklistEntry.organization_id == organization_id
        )
        if run_id is not None:
            query = query.where(TestingChecklistEntry.run_id == run_id)
        if user_id is not None:
            query = query.where(TestingChecklistEntry.user_id == user_id)
        result = await self.db.execute(query)
        await self.db.commit()
        return int(result.rowcount or 0)

    async def _positions_of(self, user: User) -> list[str]:
        """The tester's seats, for the snapshot on the row.

        Prefers the already-loaded relationship: the authentication dependency
        eager-loads it (``selectinload(User.roles)``, a synonym of
        ``positions``) because every permission check needs it, so re-querying
        would be a second round trip for data already in hand. Falls back to a
        query rather than touching an unloaded relationship — a lazy load in
        async SQLAlchemy does not merely cost a query, it raises MissingGreenlet
        and takes the save with it.
        """
        if "positions" in sa_inspect(user).unloaded:
            result = await self.db.execute(
                select(Position.name)
                .join(user_positions, Position.id == user_positions.c.position_id)
                .where(user_positions.c.user_id == user.id)
            )
            names = [name for (name,) in result.all() if name]
        else:
            names = [
                position.name
                for position in (user.positions or [])
                if getattr(position, "name", None)
            ]
        # The rank is worth recording — a Lieutenant tests differently from a
        # firefighter — but only when it says something the positions do not.
        # Seeded departments name the position after the rank, and
        # "Firefighter, firefighter" reads as a bug in the screen.
        if user.rank and not any(
            name.replace("_", " ").casefold() == user.rank.replace("_", " ").casefold()
            for name in names
        ):
            names.append(user.rank)
        return names
