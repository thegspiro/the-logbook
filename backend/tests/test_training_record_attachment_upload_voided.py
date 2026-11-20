"""A file cannot be uploaded to a voided training record.

A void is final: ``update_record`` refuses to edit one, because changing it
would hand back what the department removed behind the member's notice. The
attachment upload route did not check, so evidence could still be added to a
record the department had voided.
"""

from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException

from app.api.v1.endpoints import training_enhancements

pytestmark = pytest.mark.unit


async def test_an_upload_to_a_voided_record_is_refused_before_storing(monkeypatch):
    record = SimpleNamespace(id="rec-1", voided_at=datetime.now(UTC), attachments=[])
    monkeypatch.setattr(
        training_enhancements,
        "_load_record_for_attachment",
        AsyncMock(return_value=record),
    )
    store = AsyncMock()
    monkeypatch.setattr(
        training_enhancements,
        "FileStorageService",
        lambda db: SimpleNamespace(store_upload=store),
    )

    with pytest.raises(HTTPException) as caught:
        await training_enhancements.upload_record_attachment(
            "rec-1",
            file=SimpleNamespace(filename="card.pdf"),
            db=None,
            current_user=SimpleNamespace(id="u-1", organization_id="org-1"),
        )

    assert caught.value.status_code == 400
    assert "voided" in caught.value.detail
    store.assert_not_awaited()
    assert record.attachments == []
