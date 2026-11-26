"""The reason given for reopening minutes stays out of the application log.

MM6-16: the reopen endpoint wrote the officer's free-text reason into the log
line. A reason can name a member or a medical matter, and the audit event
already records it where access is controlled (CLAUDE.md pitfall #33: an id
rather than user-supplied text where the id is enough).
"""

import pytest
from loguru import logger
from sqlalchemy.ext.asyncio import AsyncSession

from tests.minutes_support import (
    _approve,
    _client,
    _create,
    _World,
    build_world,
)

pytestmark = [pytest.mark.integration]

REASON = "Remove the paragraph about Jordan's injury"


@pytest.fixture
async def world(db_session: AsyncSession) -> _World:
    return await build_world(db_session)


async def test_the_reopen_reason_is_not_logged(world):
    minutes = await _create(world)
    await _approve(world, minutes["id"])

    messages: list[str] = []
    sink = logger.add(lambda m: messages.append(str(m)), level="DEBUG")
    try:
        async with _client(world.db, world.approver) as c:
            resp = await c.post(
                f"/minutes/{minutes['id']}/reopen", json={"reason": REASON}
            )
    finally:
        logger.remove(sink)

    assert resp.status_code == 200, resp.text
    reopened = [m for m in messages if "Minutes reopened" in m]
    assert reopened, messages
    assert not any("injury" in m for m in messages)
