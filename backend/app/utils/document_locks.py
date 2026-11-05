"""Locks a feature takes on the Documents side before its own record.

The cross-feature lock order is written out once, at the top of
``app/services/documents_service.py`` ("canonical lock order"): document
folders, then documents, then the records in other features that point at a
document. A path that is about to make one of its records point at a
document locks the document side first, with these helpers, and only then
its own record.
"""

from typing import Any, Iterable, Optional

from sqlalchemy import select
from sqlalchemy.exc import OperationalError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.sql import Select

from app.models.document import Document

# What a NOWAIT locking read raises when a row it needs is already locked:
# MariaDB reports it as a lock wait timeout (1205), MySQL 8 as ER_LOCK_NOWAIT
# (3572). Under NOWAIT neither waited, so neither means the server is slow.
_LOCK_NOT_AVAILABLE = {1205, 3572}


class ReferenceRowBusy(ValueError):
    """A record that points at a document is locked by another transaction."""


async def lock_documents_for_reference(
    db: AsyncSession, organization_id: Any, document_ids: Iterable[Optional[str]]
) -> None:
    """Share-lock documents a record is about to point at, in id order.

    A shared lock is what the foreign key check would take anyway when the
    reference is written; taking it here, first, moves it ahead of the
    caller's own record lock. Two writers referencing one document do not
    wait on each other; a delete of it does.
    """
    ids = sorted({str(i) for i in document_ids if i})
    if not ids:
        return
    await db.execute(
        select(Document.id)
        .where(
            Document.id.in_(ids),
            Document.organization_id == str(organization_id),
        )
        .order_by(Document.id)
        .with_for_update(read=True)
    )


async def read_referencing_rows_nowait(
    db: AsyncSession, statement: Select, busy_message: str, *, exclusive: bool
) -> list:
    """Run ``statement`` as a NOWAIT locking read.

    For the Documents side reading records in another feature, which come
    later in the lock order than the document it already holds. A locking
    read sees what was committed after this transaction's snapshot, and the
    lock keeps the rows from changing until the transaction ends. NOWAIT
    because the other feature's paths may hold their record and then need
    the document (a foreign key check, at the least): waiting here could
    close that cycle, so a row somebody is changing is refused instead.

    ``exclusive`` for rows this transaction will itself write -- the ones a
    ``SET NULL`` foreign key clears when the document goes. Holding a shared
    lock and then writing is an upgrade, and an upgrade behind another
    transaction already queued for the row is a deadlock.
    """
    try:
        result = await db.execute(
            statement.with_for_update(read=not exclusive, nowait=True)
        )
    except OperationalError as exc:
        code = exc.orig.args[0] if exc.orig is not None and exc.orig.args else None
        if code in _LOCK_NOT_AVAILABLE:
            raise ReferenceRowBusy(busy_message) from exc
        raise
    return list(result.all())
