"""Two find-or-create paths on a set of minutes serialize on the minutes row.

MM-19: ``MinuteService.ensure_section_motions`` gives each section that needs
a motion its prepared motion if it has none. It looked with a plain SELECT, so
two saves of the same draft in the same instant could each find no motion and
each insert one, leaving the section with two pending motions.

MM-20: ``MinutesPublishingService._post_public`` finds or creates the one
public copy of a set of minutes. ``minutes_id`` is unique there, so a race
could not duplicate the row, but the losing publish failed at its commit with
an IntegrityError, a 500, rather than replacing the copy the winner posted.

Both now lock the minutes row before they look, and look with a locking read,
which answers from the latest committed rows rather than the snapshot the
transaction began with (pitfall #27). The first writer here is raw SQL holding
the minutes row, so the test does not depend on the code under test to create
the contention. Real connections, not ``db_session``: a race needs two
transactions.
"""

import asyncio
import json
import uuid
from datetime import datetime, timezone
from types import SimpleNamespace

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import database_manager
from app.models.minute import MeetingMinutes
from app.services.minute_service import MinuteService
from app.services.minutes_publishing_service import MinutesPublishingService

pytestmark = [pytest.mark.integration]

# How long the first writer holds the minutes row after taking its lock, so
# the code under test is certain to arrive while it is held.
_HOLD_SECONDS = 0.3

_SECTION = "new_business"


async def _seed() -> tuple[str, str]:
    """An organization, a secretary whose id is the organization's, and minutes."""
    org, minutes = str(uuid.uuid4()), str(uuid.uuid4())
    sections = [
        {
            "order": 0,
            "key": _SECTION,
            "title": "New Business",
            "content": "",
            "needs_motion": True,
            "motion_text": "Motion to purchase the hose.",
        }
    ]
    async with database_manager.engine.connect() as conn:
        async with conn.begin():
            await conn.execute(
                text(
                    "INSERT INTO organizations (id,name,organization_type,slug,"
                    "timezone,active) VALUES (:i,'Minutes Race FD',"
                    "'fire_department',:s,'UTC',1)"
                ),
                {"i": org, "s": f"min-race-{org[:8]}"},
            )
            await conn.execute(
                text(
                    "INSERT INTO users (id,organization_id,username,first_name,"
                    "last_name,email,password_hash,status) VALUES (:i,:o,:u,"
                    "'Sec','Retary',:e,'x','active')"
                ),
                {
                    "i": org,
                    "o": org,
                    "u": f"sec-{org[:8]}",
                    "e": f"sec-{org[:8]}@t.com",
                },
            )
            await conn.execute(
                text(
                    "INSERT INTO meeting_minutes (id,organization_id,title,"
                    "meeting_date,sections) VALUES (:i,:o,'Business meeting',"
                    ":d,:sec)"
                ),
                {
                    "i": minutes,
                    "o": org,
                    "d": datetime(2026, 10, 1, 19, 0),
                    "sec": json.dumps(sections),
                },
            )
    return org, minutes


async def _cleanup(org: str, minutes: str) -> None:
    async with database_manager.engine.connect() as conn:
        async with conn.begin():
            await conn.execute(
                text("DELETE FROM meeting_motions WHERE minutes_id=:m"), {"m": minutes}
            )
            await conn.execute(
                text("DELETE FROM minutes_public_copies WHERE minutes_id=:m"),
                {"m": minutes},
            )
            await conn.execute(
                text("DELETE FROM meeting_minutes WHERE id=:m"), {"m": minutes}
            )
            await conn.execute(
                text("DELETE FROM users WHERE organization_id=:o"), {"o": org}
            )
            await conn.execute(
                text("DELETE FROM organizations WHERE id=:o"), {"o": org}
            )


async def _hold_minutes_then(minutes: str, locked: asyncio.Event, sql: str, params):
    """Lock the minutes row, wait, write ``sql``, commit."""
    async with database_manager.engine.connect() as conn:
        async with conn.begin():
            await conn.execute(
                text("SELECT id FROM meeting_minutes WHERE id=:m FOR UPDATE"),
                {"m": minutes},
            )
            locked.set()
            await asyncio.sleep(_HOLD_SECONDS)
            await conn.execute(text(sql), params)


async def _load_minutes(
    session: AsyncSession, org: str, minutes: str
) -> MeetingMinutes:
    # As the endpoints load it: the printed copy reads the eager-loaded motions.
    row = await MinuteService(session).get_minutes(minutes, org)
    assert row is not None
    return row


@pytest.mark.usefixtures("_initialize_database")
async def test_two_saves_prepare_one_motion_per_section():
    org, minutes = await _seed()
    locked = asyncio.Event()

    async def second():
        await locked.wait()
        async with database_manager.engine.connect() as conn:
            session = AsyncSession(bind=conn, expire_on_commit=False)
            try:
                row = await _load_minutes(session, org, minutes)
                await MinuteService(session).ensure_section_motions(row, org)
                await session.commit()
            finally:
                await session.close()

    try:
        await asyncio.gather(
            _hold_minutes_then(
                minutes,
                locked,
                "INSERT INTO meeting_motions (id,minutes_id,`order`,motion_text,"
                "section_key,status) VALUES (:i,:m,0,'Motion to purchase the "
                "hose.',:k,'pending')",
                {"i": str(uuid.uuid4()), "m": minutes, "k": _SECTION},
            ),
            second(),
        )
        async with database_manager.engine.connect() as conn:
            count = (
                await conn.execute(
                    text(
                        "SELECT COUNT(*) FROM meeting_motions WHERE minutes_id=:m "
                        "AND section_key=:k"
                    ),
                    {"m": minutes, "k": _SECTION},
                )
            ).scalar_one()
    finally:
        await _cleanup(org, minutes)

    assert count == 1, (
        f"{count} prepared motions for one section. More than one means the "
        "save looked for the section's motion before the other save committed "
        "it, and inserted a second."
    )


@pytest.mark.usefixtures("_initialize_database")
async def test_a_publish_racing_another_replaces_the_public_copy():
    org, minutes = await _seed()
    locked = asyncio.Event()
    errors: list[BaseException] = []

    async def second():
        await locked.wait()
        async with database_manager.engine.connect() as conn:
            session = AsyncSession(bind=conn, expire_on_commit=False)
            try:
                row = await _load_minutes(session, org, minutes)
                await MinutesPublishingService(session)._post_public(
                    row, org, SimpleNamespace(id=org), 2
                )
            except BaseException as exc:  # recorded for the assertion below
                errors.append(exc)
            finally:
                await session.close()

    try:
        await asyncio.gather(
            _hold_minutes_then(
                minutes,
                locked,
                "INSERT INTO minutes_public_copies (id,organization_id,"
                "minutes_id,title,meeting_type,content,posted_at,"
                "revision_version) VALUES (:i,:o,:m,'Business meeting',"
                "'business','{}',:p,1)",
                {
                    "i": str(uuid.uuid4()),
                    "o": org,
                    "m": minutes,
                    "p": datetime.now(timezone.utc).replace(tzinfo=None),
                },
            ),
            second(),
        )
        async with database_manager.engine.connect() as conn:
            rows = (
                await conn.execute(
                    text(
                        "SELECT revision_version, replaced_version FROM "
                        "minutes_public_copies WHERE minutes_id=:m"
                    ),
                    {"m": minutes},
                )
            ).all()
    finally:
        await _cleanup(org, minutes)

    assert errors == [], (
        f"The second publish raised {errors!r}. It found no public copy, "
        "inserted one, and collided with the copy the first publish committed."
    )
    assert [tuple(r) for r in rows] == [(2, 1)]
