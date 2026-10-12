"""
Organization Lock Model

Rows that exist only to be locked, so a read-then-write decision can be
serialized per department without locking a row other writes depend on.
"""

from datetime import datetime
from typing import Optional

from sqlalchemy import DateTime, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func

from app.core.database import Base


class OrganizationLock(Base):
    """One row per (organization, scope), taken with an exclusive lock.

    For a check that cannot be made safe by locking a single parent row:
    booking a room (EV-26) or enrolling a member in a program, where the
    check is a range read. That read has to be a locking read to see rows
    committed since the request's snapshot (CLAUDE.md pitfall #27), and a
    locking range read takes InnoDB gap locks that two *different* parents
    can share, so locking per room or per program let unrelated decisions
    deadlock on each other's inserts (the failure
    ``test_storefront_order_deadlock.py`` documents for the store).

    Not the ``organizations`` row: every insert into a table with an org
    foreign key takes a shared lock on it, so an exclusive lock there would
    stall every write in the department and deadlock against paths that lock
    something else first. Nothing references this table.

    Taken through ``app.utils.org_locks.lock_organization_scope``, which
    creates the row on first use.
    """

    __tablename__ = "organization_locks"

    organization_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        primary_key=True,
    )
    scope: Mapped[str] = mapped_column(String(50), primary_key=True)
    created_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
