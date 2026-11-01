"""Two people saving one draft: the second, stale save is refused.

MM5-4, owner decision 2026-10-31. The minutes page sends the whole sections
list on every save, so a save from a copy loaded before someone else's save
wrote that copy's stale text back over theirs, behind a success toast. A save
now names the ``edit_version`` it loaded, and an older one is refused with 409.
"""

from typing import Any

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from tests.minutes_support import _client, _create, _World, build_world

pytestmark = [pytest.mark.integration]


@pytest.fixture
async def world(db_session: AsyncSession) -> _World:
    return await build_world(db_session)


async def _put(world: _World, minutes_id: str, body: dict[str, Any]):
    async with _client(world.db, world.secretary) as c:
        return await c.put(f"/minutes/{minutes_id}", json=body)


class TestEditConflict:
    async def test_a_save_from_a_stale_copy_is_refused(self, world):
        minutes = await _create(world)
        loaded = minutes["edit_version"]

        first = await _put(
            world, minutes["id"], {"title": "Alex's edit", "expected_version": loaded}
        )
        assert first.status_code == 200, first.text
        assert first.json()["edit_version"] == loaded + 1

        second = await _put(
            world, minutes["id"], {"title": "Sam's edit", "expected_version": loaded}
        )
        assert second.status_code == 409
        assert "Someone else saved these minutes" in second.json()["detail"]

    async def test_a_save_naming_the_current_version_goes_through(self, world):
        minutes = await _create(world)
        first = await _put(
            world,
            minutes["id"],
            {"title": "One", "expected_version": minutes["edit_version"]},
        )
        second = await _put(
            world,
            minutes["id"],
            {"title": "Two", "expected_version": first.json()["edit_version"]},
        )

        assert second.status_code == 200, second.text
        assert second.json()["title"] == "Two"

    async def test_a_save_without_a_version_is_unconditional(self, world):
        """Callers that predate the check keep working, and still bump it."""
        minutes = await _create(world)
        resp = await _put(world, minutes["id"], {"title": "Untracked"})

        assert resp.status_code == 200, resp.text
        assert resp.json()["edit_version"] == minutes["edit_version"] + 1
