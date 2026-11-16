"""The stored files a member's rows name, and the one rule for trusting them.

Attachment lists live in JSON columns (``training_submissions.attachments``,
``training_records.attachments``), so a ``file_path`` read back from one is
only as trustworthy as the column it round-tripped through.
:func:`confined_attachment_path` is the single definition of which entries
name a file this organization may serve or delete: every reader of a
self-report or training-record attachment calls it rather than restating it
(CLAUDE.md pitfall #29).
"""

from typing import Any, Iterable, Optional

from app.services import file_storage_service as file_storage
from app.services.file_storage_service import StorageArea


def confined_attachment_path(
    attachment: Any, organization_id: Any, *areas: StorageArea
) -> Optional[str]:
    """Real path of a stored attachment, or None if it escapes the org's areas.

    Only a dict entry with a ``file_path`` qualifies. ``file_path`` is
    server-generated, but the column round-trips through JSON: this is what
    keeps a tampered value from becoming an arbitrary file read or, on
    delete, an arbitrary unlink. Confined to the row's *own organization* in
    one of *areas* (current or legacy layout, ``..`` and symlinks resolved),
    because a root-level check would still reach another tenant's file. A
    bare string, None, a URL or a path outside those areas yields None and is
    never deleted.
    """
    if not isinstance(attachment, dict):
        return None
    return file_storage.resolve(attachment.get("file_path"), organization_id, *areas)


def confined_attachment_paths(
    attachments: Optional[Iterable[Any]], organization_id: Any, *areas: StorageArea
) -> list[str]:
    """:func:`confined_attachment_path` for each entry, dropping the Nones."""
    if not isinstance(attachments, list):
        return []
    paths = [
        confined_attachment_path(attachment, organization_id, *areas)
        for attachment in attachments
    ]
    return [path for path in paths if path]
