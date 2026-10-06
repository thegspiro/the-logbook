"""Serialize a read-then-write decision per department.

See ``app.models.organization_lock.OrganizationLock`` for why these rows
exist and why the lock is per department rather than per parent row.
"""

from typing import Any

from sqlalchemy.dialects.mysql import insert as mysql_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.organization_lock import OrganizationLock

# One scope per decision, so unrelated decisions do not wait on each other.
ROOM_BOOKING = "room_booking"
PROGRAM_ENROLLMENT = "program_enrollment"
ADMIN_CONTINUITY = "admin_continuity"


async def lock_organization_scope(
    db: AsyncSession, organization_id: Any, scope: str
) -> None:
    """Hold the (organization, scope) lock until the transaction ends.

    An upsert rather than SELECT ... FOR UPDATE, so the first decision a
    department ever makes creates the row it locks: ON DUPLICATE KEY UPDATE
    takes an exclusive lock on the row whether it inserted it or found it.

    Take it before any row lock the same decision will also take, so every
    path locks in one order.
    """
    statement = mysql_insert(OrganizationLock).values(
        organization_id=str(organization_id), scope=scope
    )
    await db.execute(statement.on_duplicate_key_update(scope=statement.inserted.scope))
