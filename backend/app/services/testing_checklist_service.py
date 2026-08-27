"""
Testing checklist service

Reads and writes the per-tester marks behind the in-app testing home.

Every query is scoped to the caller's organization (pitfall #14a) — the row id
never reaches this layer from a client, but the user id in a shared-run read
does, and one department's testing notes are not another's to read.
"""

from datetime import datetime, timezone
from typing import Optional, Sequence

from sqlalchemy import delete
from sqlalchemy import inspect as sa_inspect
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.testing_checklist import TestingChecklistEntry, TestingCheckStatus
from app.models.user import Position, User, user_positions
from app.schemas.testing_checklist import TestingCheckUpsert

# A run covers the pages the router declares — a few hundred. The cap is well
# clear of that and exists so a scripted client cannot grow the table without
# bound (pitfall #9); it is per tester, so one person's junk cannot stop
# another recording a real result.
MAX_ENTRIES_PER_USER = 600


class TestingChecklistService:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def list_entries(
        self,
        organization_id: str,
        user_id: str,
        include_all_testers: bool = False,
    ) -> list[TestingChecklistEntry]:
        """The caller's own marks, or every tester's in the department."""
        query = select(TestingChecklistEntry).where(
            TestingChecklistEntry.organization_id == organization_id
        )
        if not include_all_testers:
            query = query.where(TestingChecklistEntry.user_id == user_id)
        result = await self.db.execute(
            query.order_by(
                TestingChecklistEntry.route_path,
                TestingChecklistEntry.updated_at.desc(),
            )
        )
        return list(result.scalars().all())

    async def resolve_tester_names(
        self, organization_id: str, entries: Sequence[TestingChecklistEntry]
    ) -> dict[str, str]:
        """Names for the accounts that made the marks.

        A truncated UUID identifies nobody, and the whole point of the shared
        run is knowing which seat produced a result. Batched, and org-scoped
        because the ids come from stored rows.
        """
        user_ids = {entry.user_id for entry in entries}
        if not user_ids:
            return {}
        result = await self.db.execute(
            select(User.id, User.first_name, User.last_name, User.username).where(
                User.id.in_(user_ids),
                User.organization_id == organization_id,
            )
        )
        return {
            str(user_id): f"{first or ''} {last or ''}".strip() or username
            for user_id, first, last, username in result.all()
        }

    async def upsert_entry(
        self,
        organization_id: str,
        user: User,
        payload: TestingCheckUpsert,
    ) -> TestingChecklistEntry:
        """Record one tester's finding on one page, replacing their previous one."""
        result = await self.db.execute(
            select(TestingChecklistEntry).where(
                TestingChecklistEntry.organization_id == organization_id,
                TestingChecklistEntry.user_id == user.id,
                TestingChecklistEntry.route_path == payload.route_path,
            )
        )
        entry = result.scalar_one_or_none()

        if entry is None:
            count = len(await self.list_entries(organization_id, str(user.id)))
            if count >= MAX_ENTRIES_PER_USER:
                raise ValueError(
                    "This testing run already covers the maximum number of pages"
                )
            entry = TestingChecklistEntry(
                organization_id=organization_id,
                user_id=str(user.id),
                route_path=payload.route_path,
            )
            self.db.add(entry)

        entry.status = payload.status
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
    ) -> int:
        """Delete one tester's marks, or the whole department's.

        ``user_id=None`` clears every tester — reserved for the caller who can
        already read every tester, and audited by the endpoint.
        """
        query = delete(TestingChecklistEntry).where(
            TestingChecklistEntry.organization_id == organization_id
        )
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
