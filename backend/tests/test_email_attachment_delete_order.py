"""Deleting an email attachment must not lose the file silently.

The `email_attachments` row is the only record that the file on disk exists —
nothing sweeps the template attachment storage, and there is no orphan-cleanup task
anywhere in the repository. That makes the order of the two operations, and what
happens to a failed unlink, a correctness question rather than a style one.

If the row is committed away first and an `os.remove` failure is then swallowed,
a transient EACCES/EIO leaves the file on disk forever with nothing pointing at
it, while the API reports 204. These are member-facing attachments, so what
survives can be precisely the document the department believes it just deleted.

So: unlink first, let a real failure propagate, and only then delete the row.
That is recoverable in both directions — a failed unlink changes nothing, and a
failed commit leaves a row whose retry finds the file already gone and completes.

Codex raised this as a P2 on PR #2446 against an earlier draft that had the two
the other way round.
"""

import os
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.api.v1.endpoints.email_templates import delete_attachment
from app.core.config import settings
from app.services.file_storage_service import StorageArea, get_file_storage


def _attachment(tmp_path):
    stored = get_file_storage().save(
        b"%PDF-1.4 member document",
        organization_id="org-1",
        area=StorageArea.EMAIL_TEMPLATES,
        entity_id="tpl-1",
    )
    return SimpleNamespace(
        id="att-1",
        template_id="tpl-1",
        filename="member-document.pdf",
        storage_path=stored.key,
    )


def _on_disk(attachment) -> str:
    return os.path.join(settings.UPLOAD_DIR, attachment.storage_path)


def _db_returning(attachment):
    """A db whose single SELECT resolves to *attachment*."""
    execute_result = MagicMock()
    execute_result.scalar_one_or_none = MagicMock(return_value=attachment)
    db = MagicMock()
    db.execute = AsyncMock(return_value=execute_result)
    db.delete = AsyncMock()
    db.commit = AsyncMock()
    return db


def _user():
    return SimpleNamespace(id="user-1", organization_id="org-1")


@pytest.mark.asyncio
class TestDeleteAttachmentOrdering:
    async def test_a_failed_unlink_leaves_the_row_intact(self, tmp_path, monkeypatch):
        """The load-bearing case: the file could not be removed, so the record
        of it must survive for the admin to retry against."""
        attachment = _attachment(tmp_path)
        db = _db_returning(attachment)

        def _boom(path):
            raise PermissionError(13, "Permission denied", path)

        monkeypatch.setattr(os, "remove", _boom)

        with pytest.raises(PermissionError):
            await delete_attachment("tpl-1", "att-1", db=db, current_user=_user())

        db.delete.assert_not_awaited()
        db.commit.assert_not_awaited()
        assert os.path.isfile(_on_disk(attachment)), (
            "the file should still be on disk after a failed unlink — if it is "
            "gone the test is not exercising what it claims to"
        )

    async def test_a_successful_delete_removes_file_then_row(
        self, tmp_path, monkeypatch
    ):
        attachment = _attachment(tmp_path)
        db = _db_returning(attachment)

        order: list[str] = []
        real_remove = os.remove

        def _tracked(path):
            order.append("unlink")
            real_remove(path)

        monkeypatch.setattr(os, "remove", _tracked)
        db.delete = AsyncMock(side_effect=lambda _: order.append("delete"))

        await delete_attachment("tpl-1", "att-1", db=db, current_user=_user())

        assert order == ["unlink", "delete"], (
            "the file must be removed before the row is deleted; the row is the "
            "only record the file exists"
        )
        assert not os.path.exists(_on_disk(attachment))
        db.commit.assert_awaited()

    async def test_an_already_missing_file_is_not_an_error(self, tmp_path, monkeypatch):
        """What a retry after a half-completed delete looks like: the previous
        attempt unlinked the file and then failed to commit, so the row is still
        here and the file is not. That must complete, not 500 forever."""
        attachment = _attachment(tmp_path)
        os.remove(_on_disk(attachment))
        db = _db_returning(attachment)

        await delete_attachment("tpl-1", "att-1", db=db, current_user=_user())

        db.delete.assert_awaited()
        db.commit.assert_awaited()
