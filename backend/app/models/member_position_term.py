"""
Member Position Terms

A dated history of the offices and committee seats each member has held
(owner decision 2026-11-06). ``user_positions`` says only who holds a position
now: assigning adds a row and removing deletes it. Each row here is one term:
``started_at`` when the position was assigned, ``ended_at`` when it was taken
away, NULL while it is still held.

**Nothing calls this from the paths that assign positions.** They are many --
the position endpoints, member creation, onboarding, the membership pipeline,
the position service's Core statements, position deletion -- and a future one
would be another place to forget. So a session hook watches every flush: any
change to ``User.positions`` or ``Position.users`` names the (member,
position) pairs it touched, and after the flush each pair's open term is made
to agree with ``user_positions`` in the same transaction. A path that writes
``user_positions`` with a Core statement instead of the relationship calls
:func:`sync_position_terms` with the pairs it touched, which runs the same
reconciliation.

Reconciling against ``user_positions`` rather than replaying the change is
what makes it idempotent: a pair already held with an open term opens nothing,
a pair not held with no open term closes nothing, and a pair touched twice in
one flush (removed and re-added) ends the way the table ended.

Who made the change is recorded when the path knows it: a caller names the
actor with :func:`note_position_actor` (the position endpoints do), and a
Core path passes it to :func:`sync_position_terms`. A term opened by the
system -- onboarding, the membership pipeline's conversion -- has none.
"""

from datetime import datetime, timezone
from typing import Any, Iterable, Optional

from sqlalchemy import (
    CheckConstraint,
    Computed,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    UniqueConstraint,
    event,
    insert,
    inspect,
    select,
    update,
)
from sqlalchemy.engine import Connection
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import Mapped, Session, mapped_column
from sqlalchemy.sql import Select

from app.core.database import Base
from app.core.utils import generate_uuid
from app.models.user import Position, User, user_positions

# The generated column's expression, shared with the migration that creates
# the table so the two cannot drift.
OPEN_MARKER_EXPRESSION = "CASE WHEN ended_at IS NULL THEN 1 ELSE NULL END"

# session.info key naming who is making this session's position changes.
_ACTOR = "position_terms_actor_id"


class MemberPositionTerm(Base):
    """One stretch of time during which ``user_id`` held ``position_id``.

    **At most one open term per member and position, enforced by the
    database.** MySQL has no partial unique index, so ``open_marker`` is a
    stored generated column that is 1 while ``ended_at`` is NULL and NULL once
    the term is closed; the unique key on ``(user_id, position_id,
    open_marker)`` then admits one open term and any number of closed ones,
    because MySQL treats NULLs as distinct. The expression reads ``ended_at``
    only: MySQL refuses a stored generated column whose base column carries a
    foreign key with a referential action. The ``user_positions`` primary key
    is what serializes two concurrent assignments of the same pair, so the
    unique key is a backstop rather than the lock.

    **The history outlives the position.** ``position_id`` is SET NULL, and
    ``position_name`` / ``position_kind`` are copied at assignment, so a
    position deleted outright leaves its terms readable under the name it had.
    Deleting a position closes its open terms first (see
    ``_close_terms_of_deleted_positions``). ``user_id`` is CASCADE: the
    history is the member's and goes with a hard-deleted member, as their
    ``user_positions`` rows do. ``assigned_by`` / ``ended_by`` are SET NULL
    so hard-deleting the officer who made a change keeps the dates.
    """

    __tablename__ = "member_position_terms"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    organization_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False
    )
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    position_id: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("positions.id", ondelete="SET NULL"), nullable=True
    )
    position_name: Mapped[str] = mapped_column(String(100), nullable=False)
    position_kind: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    started_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    ended_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    open_marker: Mapped[Optional[int]] = mapped_column(
        Integer, Computed(OPEN_MARKER_EXPRESSION, persisted=True)
    )
    assigned_by: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    ended_by: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    __table_args__ = (
        UniqueConstraint(
            "user_id",
            "position_id",
            "open_marker",
            name="uq_member_position_terms_open",
        ),
        CheckConstraint(
            "ended_at IS NULL OR ended_at >= started_at", name="date_order"
        ),
        Index(
            "ix_member_position_terms_org_user",
            "organization_id",
            "user_id",
            "started_at",
        ),
        Index("ix_member_position_terms_position", "position_id"),
    )

    def __repr__(self) -> str:
        return (
            f"<MemberPositionTerm(user_id={self.user_id}, "
            f"position={self.position_name}, {self.started_at} - {self.ended_at})>"
        )


def note_position_actor(session: Session | AsyncSession, actor_id: Any) -> None:
    """Record ``actor_id`` as the member making this session's position changes."""
    session.info[_ACTOR] = str(actor_id) if actor_id is not None else None


def _reconcile(
    conn: Connection,
    pairs: Iterable[tuple[str, str]],
    actor_id: Optional[str],
    now: datetime,
) -> None:
    """Make each pair's open term agree with ``user_positions``."""
    terms = MemberPositionTerm
    for user_id, position_id in sorted(set(pairs)):
        held = conn.execute(
            select(
                User.organization_id,
                Position.name,
                Position.kind,
                user_positions.c.assigned_by,
            )
            .select_from(user_positions)
            .join(User, User.id == user_positions.c.user_id)
            .join(Position, Position.id == user_positions.c.position_id)
            .where(
                user_positions.c.user_id == user_id,
                user_positions.c.position_id == position_id,
            )
        ).first()
        is_open = (
            conn.execute(
                select(terms.id)
                .where(
                    terms.user_id == user_id,
                    terms.position_id == position_id,
                    terms.ended_at.is_(None),
                )
                .limit(1)
            ).first()
            is not None
        )
        if held is not None and not is_open:
            conn.execute(
                insert(terms).values(
                    id=generate_uuid(),
                    organization_id=held.organization_id,
                    user_id=user_id,
                    position_id=position_id,
                    position_name=held.name,
                    position_kind=held.kind,
                    started_at=now,
                    assigned_by=actor_id or held.assigned_by,
                )
            )
        elif held is None and is_open:
            conn.execute(
                update(terms)
                .where(
                    terms.user_id == user_id,
                    terms.position_id == position_id,
                    terms.ended_at.is_(None),
                )
                .values(ended_at=now, ended_by=actor_id)
            )


async def sync_position_terms(
    db: AsyncSession,
    pairs: Iterable[tuple[Any, Any]],
    actor_id: Any = None,
) -> None:
    """Reconcile the terms of pairs a Core statement added or removed.

    For a path that writes ``user_positions`` directly rather than through
    ``User.positions``; the flush hook cannot see those writes.
    """
    normalized = [(str(u), str(p)) for u, p in pairs]
    if not normalized:
        return
    actor = str(actor_id) if actor_id is not None else db.info.get(_ACTOR)
    now = datetime.now(timezone.utc)
    await db.run_sync(lambda s: _reconcile(s.connection(), normalized, actor, now))


async def close_terms_for_positions(
    db: AsyncSession, position_ids: "Select[Any] | list[str]"
) -> None:
    """Close the open terms of positions a bulk statement is about to delete.

    A bulk ``DELETE`` of positions bypasses the flush hook, and the foreign
    key would then leave the open terms pointing at nothing.
    """
    terms = MemberPositionTerm
    await db.execute(
        update(terms)
        .where(terms.position_id.in_(position_ids), terms.ended_at.is_(None))
        .values(ended_at=datetime.now(timezone.utc), ended_by=db.info.get(_ACTOR))
    )


@event.listens_for(Session, "before_flush")
def _close_terms_of_deleted_positions(
    session: Session, flush_context: Any, instances: Any
) -> None:
    """A position deleted outright ends every term still open in it.

    Done before the flush: once the position row is gone the foreign key has
    already set the terms' ``position_id`` to NULL, and they can no longer be
    found by it.
    """
    position_ids = [
        str(obj.id)
        for obj in session.deleted
        if isinstance(obj, Position) and obj.id is not None
    ]
    if not position_ids:
        return
    terms = MemberPositionTerm
    session.connection().execute(
        update(terms)
        .where(terms.position_id.in_(position_ids), terms.ended_at.is_(None))
        .values(ended_at=datetime.now(timezone.utc), ended_by=session.info.get(_ACTOR))
    )


@event.listens_for(Session, "after_flush")
def _record_position_terms(session: Session, flush_context: Any) -> None:
    """Open or close terms for every pair the flush assigned or removed.

    After the flush so a member or position created in it exists for the
    term's foreign keys; the attribute history still holds the pre-flush
    changes at this point.
    """
    pairs: set[tuple[str, str]] = set()
    for obj in list(session.new) + list(session.dirty):
        if obj in session.deleted:
            continue
        if isinstance(obj, User):
            history = inspect(obj).attrs.positions.history
            for position in (*history.added, *history.deleted):
                if position is not None and position.id is not None:
                    pairs.add((str(obj.id), str(position.id)))
        elif isinstance(obj, Position):
            history = inspect(obj).attrs.users.history
            for member in (*history.added, *history.deleted):
                if member is not None and member.id is not None:
                    pairs.add((str(member.id), str(obj.id)))
    if not pairs:
        return
    _reconcile(
        session.connection(),
        pairs,
        session.info.get(_ACTOR),
        datetime.now(timezone.utc),
    )
