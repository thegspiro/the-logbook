"""A shift logged while its department is being merged takes the kept name.

The merge relabels every shift on the units it moves. A member logging a shift
on one of those units at the same moment reads the unit's department for the
name copied onto the shift. Read off a stale snapshot, that name is the
merged-away one, and the shift lands on the moved unit still carrying it, after
the relabel has already run (review finding on PR #4404).

``get_pickable_apparatus`` takes a shared lock on the unit row, and the merge
an exclusive one, so the two serialize in either order. Both orders are driven
here on real connections, each pausing one side while the other arrives.
"""

import asyncio
import json
import uuid
from datetime import date

import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import database_manager
from app.services.external_apparatus_service import ExternalApparatusService
from app.services.external_shift_hours_service import ExternalShiftHoursService

pytestmark = [pytest.mark.integration]

COUNTY = "Arlington County"
COUNTY_FD = "Arlington County Fire Department"
# How long the paused side holds its locks, so the other is certain to
# arrive while they are held.
_HOLD_SECONDS = 0.3


async def _seed() -> dict:
    ids = {k: str(uuid.uuid4()) for k in ("org", "user", "source", "target", "unit")}
    async with database_manager.engine.connect() as conn:
        async with conn.begin():
            await conn.execute(
                text(
                    "INSERT INTO organizations (id, name, organization_type, slug, "
                    "timezone, active, settings) VALUES (:id, 'Merge Race Dept', "
                    "'fire_department', :slug, 'UTC', 1, :settings)"
                ),
                {
                    "id": ids["org"],
                    "slug": f"merge-race-{ids['org'][:8]}",
                    "settings": json.dumps({}),
                },
            )
            await conn.execute(
                text(
                    "INSERT INTO users (id, organization_id, username, first_name, "
                    "last_name, email, password_hash, status) VALUES (:id, :org, "
                    ":un, 'Merge', 'Racer', :em, 'hashed', 'active')"
                ),
                {
                    "id": ids["user"],
                    "org": ids["org"],
                    "un": f"merge-race-{ids['user'][:8]}",
                    "em": f"merge-race-{ids['user'][:8]}@test.com",
                },
            )
            for key, name in (("source", COUNTY), ("target", COUNTY_FD)):
                await conn.execute(
                    text(
                        "INSERT INTO external_agencies (id, organization_id, name, "
                        "is_active, evaluate_shifts) VALUES (:id, :org, :name, 1, 0)"
                    ),
                    {"id": ids[key], "org": ids["org"], "name": name},
                )
            await conn.execute(
                text(
                    "INSERT INTO external_apparatus (id, organization_id, agency_id, "
                    "name, is_active) VALUES (:id, :org, :agency, 'FAS', 1)"
                ),
                {"id": ids["unit"], "org": ids["org"], "agency": ids["source"]},
            )
    return ids


async def _cleanup(org_id: str) -> None:
    async with database_manager.engine.connect() as conn:
        async with conn.begin():
            for statement in (
                "DELETE FROM external_shift_hours WHERE organization_id = :o",
                "DELETE FROM external_apparatus WHERE organization_id = :o",
                "DELETE FROM external_agencies WHERE organization_id = :o",
                "DELETE FROM users WHERE organization_id = :o",
                "DELETE FROM organizations WHERE id = :o",
            ):
                await conn.execute(text(statement), {"o": org_id})


async def _in_session(work, *, after=None):
    if after is not None:
        await after.wait()
    async with database_manager.engine.connect() as conn:
        session = AsyncSession(bind=conn, expire_on_commit=False)
        try:
            await work(session)
            return "ok"
        except DBAPIError as exc:
            await session.rollback()
            return "deadlock" if "1213" in str(exc) else f"other:{exc}"
        finally:
            await session.close()


def _merge(ids):
    async def work(session):
        await ExternalApparatusService(session).merge_agency(
            ids["org"], ids["source"], ids["target"]
        )

    return work


def _log(ids):
    async def work(session):
        await ExternalShiftHoursService(session).create(
            ids["org"],
            ids["user"],
            {
                "shift_date": date(2025, 6, 1),
                "hours": 10,
                "external_apparatus_id": ids["unit"],
            },
        )

    return work


async def _logged_names(org_id: str) -> list[tuple[str, str]]:
    async with database_manager.engine.connect() as conn:
        rows = await conn.execute(
            text(
                "SELECT agency_name, external_apparatus_id FROM external_shift_hours "
                "WHERE organization_id = :o"
            ),
            {"o": org_id},
        )
        return [(r[0], r[1]) for r in rows]


def _pause_first_call(monkeypatch, cls, name):
    """Pause the first call of ``cls.name`` once it returns, and signal."""
    reached = asyncio.Event()
    original = getattr(cls, name)
    calls = []

    async def paused(self, *args, **kwargs):
        result = await original(self, *args, **kwargs)
        calls.append(1)
        if len(calls) == 1:
            reached.set()
            await asyncio.sleep(_HOLD_SECONDS)
        return result

    monkeypatch.setattr(cls, name, paused)
    return reached


@pytest.mark.usefixtures("_initialize_database")
async def test_a_shift_logged_during_a_merge_takes_the_kept_name(monkeypatch):
    """The merge has locked the units and is mid-way when the member logs."""
    ids = await _seed()
    # Called once per source unit, after the merge has locked the units.
    merge_holding = _pause_first_call(
        monkeypatch, ExternalApparatusService, "_same_named_unit"
    )
    try:
        results = await asyncio.gather(
            _in_session(_merge(ids)),
            _in_session(_log(ids), after=merge_holding),
        )
        logged = await _logged_names(ids["org"])
    finally:
        await _cleanup(ids["org"])

    assert results == ["ok", "ok"], results
    assert logged == [(COUNTY_FD, ids["unit"])], (
        f"a shift logged during the merge was stored as {logged}: it read the "
        "unit's department before the merge committed."
    )


@pytest.mark.usefixtures("_initialize_database")
async def test_a_merge_started_while_a_shift_is_logged_relabels_it(monkeypatch):
    """The member has picked the unit and is mid-way when the merge starts."""
    ids = await _seed()
    log_holding = _pause_first_call(
        monkeypatch, ExternalShiftHoursService, "_apparatus_snapshot"
    )
    try:
        results = await asyncio.gather(
            _in_session(_log(ids)),
            _in_session(_merge(ids), after=log_holding),
        )
        logged = await _logged_names(ids["org"])
    finally:
        await _cleanup(ids["org"])

    assert results == ["ok", "ok"], results
    assert logged == [(COUNTY_FD, ids["unit"])], (
        f"a shift being logged as the merge began was stored as {logged}: the "
        "merge relabelled before the shift was written."
    )
