"""Deleting minutes, or an item on them, leaves nothing stranded.

Two things a delete used to leave behind:

* the original of a carried-forward action item. Carrying stamps it
  ``carried_forward_at`` so it stops counting as open; deleting the copy (on
  its own, or with its draft minutes) left that stamp, so the original was
  hidden from every open-items list and could never be carried again;
* the files of a draft's attachments. Their rows go by database cascade, which
  never touches the stored bytes.
"""

from datetime import datetime, timezone
from typing import Any

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.minute import ActionItem
from app.services import file_storage_service as file_storage
from app.services import upload_scanning
from tests.minutes_support import (
    _approve,
    _client,
    _create,
    _pdf_bytes,
    _World,
    build_world,
)

pytestmark = [pytest.mark.integration]


@pytest.fixture(autouse=True)
def storage(tmp_path, monkeypatch):
    monkeypatch.setattr(file_storage, "UPLOADS_ROOT", str(tmp_path))
    monkeypatch.setattr(upload_scanning, "is_malware_scan_enabled", lambda: False)
    return tmp_path


@pytest.fixture
async def world(db_session: AsyncSession) -> _World:
    return await build_world(db_session)


async def _carried(world: _World) -> tuple[str, str, str]:
    """An approved item carried into a new draft: (original, draft, copy)."""
    earlier = await _create(
        world,
        when=datetime(2026, 9, 1, 19, 0, tzinfo=timezone.utc),
        items=[{"description": "Order hose"}],
    )
    await _approve(world, earlier["id"])
    original_id = earlier["action_items"][0]["id"]
    draft = await _create(world)
    async with _client(world.db, world.secretary) as c:
        resp = await c.post(
            f"/minutes/{draft['id']}/carry-forward",
            json={"item_ids": [original_id]},
        )
    assert resp.status_code == 201, resp.text
    (copy,) = resp.json()
    return original_id, draft["id"], copy["id"]


async def _offered(world: _World, into: dict[str, Any]) -> list[str]:
    async with _client(world.db, world.secretary) as c:
        resp = await c.get(f"/minutes/{into['id']}/open-action-items")
    assert resp.status_code == 200, resp.text
    return [o["id"] for o in resp.json()]


async def _carried_at(world: _World, item_id: str):
    # A column read, not an entity: it always comes from the database, and
    # leaves the session's users loaded for the endpoint calls that follow.
    result = await world.db.execute(
        select(ActionItem.carried_forward_at).where(ActionItem.id == item_id)
    )
    return result.scalar_one()


class TestDeletingACarriedCopy:
    async def test_deleting_the_copy_reopens_the_original(self, world: _World):
        original_id, draft_id, copy_id = await _carried(world)
        assert await _carried_at(world, original_id) is not None

        async with _client(world.db, world.secretary) as c:
            resp = await c.delete(f"/minutes/{draft_id}/action-items/{copy_id}")
        assert resp.status_code == 204, resp.text

        assert await _carried_at(world, original_id) is None
        assert original_id in await _offered(world, {"id": draft_id})

    async def test_deleting_the_draft_reopens_the_original(self, world: _World):
        original_id, draft_id, _copy_id = await _carried(world)

        async with _client(world.db, world.secretary) as c:
            resp = await c.delete(f"/minutes/{draft_id}")
        assert resp.status_code == 204, resp.text

        assert await _carried_at(world, original_id) is None
        later = await _create(world, title="Next")
        assert original_id in await _offered(world, later)

    async def test_an_unrelated_delete_leaves_the_original_carried(self, world: _World):
        original_id, draft_id, _copy_id = await _carried(world)
        async with _client(world.db, world.secretary) as c:
            created = await c.post(
                f"/minutes/{draft_id}/action-items",
                json={"description": "Wash the engine"},
            )
            assert created.status_code in (200, 201), created.text
            resp = await c.delete(
                f"/minutes/{draft_id}/action-items/{created.json()['id']}"
            )
        assert resp.status_code == 204, resp.text
        assert await _carried_at(world, original_id) is not None


class TestDeletingADraftWithAttachments:
    async def test_the_stored_files_are_removed(self, world: _World, storage):
        minutes = await _create(world)
        async with _client(world.db, world.secretary) as c:
            uploaded = await c.post(
                f"/minutes/{minutes['id']}/attachments",
                files={"file": ("report.pdf", _pdf_bytes(), "application/pdf")},
                data={"title": "Treasurer report", "category": "report"},
            )
            assert uploaded.status_code == 201, uploaded.text
            assert [p for p in storage.rglob("*") if p.is_file()]

            resp = await c.delete(f"/minutes/{minutes['id']}")
        assert resp.status_code == 204, resp.text
        assert [p for p in storage.rglob("*") if p.is_file()] == []
