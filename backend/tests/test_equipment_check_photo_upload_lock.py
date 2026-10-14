"""
Equipment-check photo uploads merge into the item's list under a row lock
(security review EC pass 8, EC8-14-1).

``upload_check_item_photos`` read ``photo_urls`` with a plain SELECT, spent
the scan and re-encode, then wrote ``existing + new``. Two uploads to the same
item therefore both appended to the same stale list: the later commit dropped
the earlier one's photos, and the three-photo cap was checked against a count
that was no longer true. The fix re-reads the row ``FOR UPDATE`` just before
the merge, so these tests hand the endpoint a stale first read and a fresher
locked one and assert the merge and the cap follow the locked one.
"""

import io
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest
from fastapi import HTTPException
from PIL import Image
from starlette.datastructures import Headers, UploadFile

from app.api.v1.endpoints import equipment_check as equipment_check_endpoint
from app.models.training import ShiftEquipmentCheckItem

pytestmark = pytest.mark.unit

ORG = str(uuid4())


def _png(colour: str) -> bytes:
    buffer = io.BytesIO()
    Image.new("RGB", (8, 8), colour).save(buffer, format="PNG")
    return buffer.getvalue()


def _upload(content: bytes) -> UploadFile:
    return UploadFile(
        file=io.BytesIO(content),
        filename="photo.png",
        headers=Headers({"content-type": "image/png"}),
    )


def _result(value):
    result = MagicMock()
    result.scalar_one_or_none = MagicMock(return_value=value)
    result.scalars = MagicMock(
        return_value=MagicMock(
            first=MagicMock(return_value=value), one=MagicMock(return_value=value)
        )
    )
    return result


def _db(stale_item, checked_by, locked_item):
    """Answers the item lookup, the checker lookup and the locked re-read,
    in that order, and records every statement executed."""
    queue = [_result(stale_item), _result(checked_by), _result(locked_item)]
    statements = []

    async def _execute(statement, *_args, **_kwargs):
        statements.append(statement)
        return queue.pop(0)

    db = MagicMock()
    db.execute = AsyncMock(side_effect=_execute)
    db.commit = AsyncMock()
    return db, statements


def _checker():
    return SimpleNamespace(
        id=str(uuid4()),
        organization_id=ORG,
        positions=[SimpleNamespace(permissions=["inventory.check_submit"])],
        rank=None,
    )


async def _call(db, user, colours):
    return await equipment_check_endpoint.upload_check_item_photos(
        "check-1", "item-1", [_upload(_png(c)) for c in colours], db, user
    )


async def test_the_merge_keeps_photos_another_upload_committed_meanwhile():
    user = _checker()
    stale = SimpleNamespace(photo_urls=[])
    locked = ShiftEquipmentCheckItem(photo_urls=["data:image/webp;base64,EARLIER"])
    db, statements = _db(stale, user.id, locked)

    response = await _call(db, user, ["red"])

    assert response["count"] == 2
    assert response["photo_urls"][0] == "data:image/webp;base64,EARLIER"
    assert locked.photo_urls == response["photo_urls"]
    db.commit.assert_awaited_once()
    assert "FOR UPDATE" in str(statements[2].compile())


async def test_the_cap_is_checked_against_the_locked_count():
    user = _checker()
    stale = SimpleNamespace(photo_urls=[])
    locked = ShiftEquipmentCheckItem(
        photo_urls=[f"data:image/webp;base64,P{i}" for i in range(3)]
    )
    db, _ = _db(stale, user.id, locked)

    with pytest.raises(HTTPException) as refused:
        await _call(db, user, ["blue"])

    assert refused.value.status_code == 400
    assert "already has 3 photo(s)" in refused.value.detail
    db.commit.assert_not_awaited()
