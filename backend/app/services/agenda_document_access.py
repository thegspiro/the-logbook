"""Which linked documents a given viewer may be shown.

An agenda item links Documents-library files and keeps their names so the
minutes can show them. Linking is checked against the *linker's* folder access,
but the name is then returned to everyone who can read the meeting or the
minutes, and those readers do not all have the linker's access: a leadership-only
folder's file title must not reach a member who could not open the file. So the
references are filtered again, per viewer, on every read that carries them.

The stored copy is never touched; only the response is narrowed, and a
reference that cannot be resolved (the document or its folder is gone) fails
closed and is hidden.
"""

from typing import Any, Iterable, Set
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.document import Document
from app.models.user import User
from app.services.documents_service import DocumentsService


def has_linked_documents(raw_items: Any) -> bool:
    """Whether any agenda item in the stored JSON links a document.

    The common meeting has none, and then there is nothing to narrow and no
    reason to rebuild the response.
    """
    if not isinstance(raw_items, list):
        return False
    return any(isinstance(item, dict) and item.get("documents") for item in raw_items)


async def openable_document_ids(
    db: AsyncSession,
    organization_id: UUID | str,
    user: User,
    document_ids: Iterable[str],
) -> Set[str]:
    """The ids among *document_ids* that *user* could open in the library."""
    wanted = {str(i) for i in document_ids if i}
    if not wanted:
        return set()
    rows = (
        (
            await db.execute(
                select(Document).where(
                    Document.id.in_(wanted),
                    Document.organization_id == str(organization_id),
                )
            )
        )
        .scalars()
        .all()
    )
    documents = DocumentsService(db)
    return {
        row.id
        for row in rows
        if await documents.can_access_document(row, organization_id, user)
    }


async def narrow_documents(
    db: AsyncSession,
    organization_id: UUID | str,
    user: User,
    holders: Iterable[Any],
) -> None:
    """Drop, from each holder's ``documents``, the ones *user* cannot open.

    A holder is a response object with a ``documents`` list of ``id``-bearing
    entries: an agenda item or a minutes section. They are response copies, not
    ORM rows, so narrowing them cannot be written back.
    """
    items = list(holders)
    ids = {
        str(ref["id"] if isinstance(ref, dict) else ref.id)
        for ref in (r for h in items for r in (h.documents or []))
    }
    allowed = await openable_document_ids(db, organization_id, user, ids)
    for holder in items:
        holder.documents = [
            ref
            for ref in (holder.documents or [])
            if str(ref["id"] if isinstance(ref, dict) else ref.id) in allowed
        ]
