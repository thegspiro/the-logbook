"""Minutes record keeping: attendance status, election results, attachments, revisions

* ``meeting_minutes.attendees`` — every stored entry is rewritten to the
  canonical shape (``status`` plus a ``present`` derived from it, and ``note``).
  A legacy entry becomes ``present`` when it was present, ``excused`` when the
  meetings bridge marked it excused, otherwise ``absent``; a legacy free-text
  guest stays ``present`` because it was counted toward the quorum recorded
  with it. The helper is inlined: a migration must keep transforming rows the
  way it did the day it ran, so it cannot import a function that is free to
  change.
* ``minutes_action_items.carried_from_id`` / ``carried_forward_at`` — carry an
  open action item into the next meeting's minutes.
* ``minutes_election_results`` — an election's result frozen into the minutes.
* ``minutes_attachments`` — files kept with the minutes.
* ``minutes_revisions`` — one immutable row per approval, with its hash.

Nothing is backfilled into the new tables: no minutes carried any of this
before. Approved minutes therefore have no revision until they are reopened and
approved again; the revisions screen says so rather than inventing a hash for
content nobody hashed at the time.

Each altered table may be built by ``create_all`` rather than a migration, so
every step is skipped when its table is absent, and the new tables are only
created when the tables their keys point at exist.

The downgrade drops the three tables and the two columns. Election results,
attachment records and approval hashes are lost with them, and the stored files
under ``minutes-attachments/`` stay on disk, unreferenced. The attendee rewrite
is not reversed: the added keys are ignored by older code and ``present`` was
kept correct throughout, so there is nothing a downgrade needs to restore.

Revision ID: 8efc77d4c0c3
Revises: 252c7517d80a
Create Date: 2026-10-14 17:19:17.381883

"""

from typing import Any, Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "8efc77d4c0c3"
down_revision: Union[str, None] = "252c7517d80a"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

MINUTES = "meeting_minutes"
ITEMS = "minutes_action_items"
RESULTS = "minutes_election_results"
ATTACHMENTS = "minutes_attachments"
REVISIONS = "minutes_revisions"
ITEM_FK = "fk_minutes_action_items_carried_from_id_minutes_action_items"
ITEM_IX = "ix_minutes_action_items_carried_from_id"

_STATUSES = ("present", "late", "left_early", "excused", "absent", "guest")
_COUNTS = ("present", "late", "left_early")


def _inspector():
    return sa.inspect(op.get_bind())


def _has_table(table: str) -> bool:
    return table in _inspector().get_table_names()


def _columns(table: str) -> set[str]:
    return {c["name"] for c in _inspector().get_columns(table)}


def _has_fk(table: str, name: str) -> bool:
    return name in {fk.get("name") for fk in _inspector().get_foreign_keys(table)}


def _has_index(table: str, name: str) -> bool:
    return name in {ix.get("name") for ix in _inspector().get_indexes(table)}


def _normalize(entry: Any) -> Any:
    """Frozen copy of the canonical attendee shape; see the module docstring."""
    if not isinstance(entry, dict):
        return entry
    status = entry.get("status")
    if status not in _STATUSES:
        if entry.get("present", True):
            status = "present"
        else:
            status = "excused" if entry.get("excused") else "absent"
    return {
        "user_id": entry.get("user_id") or None,
        "name": entry.get("name") or "Unknown",
        "role": entry.get("role") or None,
        "status": status,
        "present": status in _COUNTS,
        "note": entry.get("note") or None,
    }


def _settle_attendees() -> None:
    minutes = sa.table(
        MINUTES, sa.column("id", sa.String), sa.column("attendees", sa.JSON)
    )
    bind = op.get_bind()
    rows = bind.execute(
        sa.select(minutes.c.id, minutes.c.attendees).where(
            minutes.c.attendees.isnot(None)
        )
    ).fetchall()
    for minutes_id, attendees in rows:
        if not isinstance(attendees, list):
            continue
        settled = [_normalize(e) for e in attendees]
        if settled != attendees:
            bind.execute(
                minutes.update()
                .where(minutes.c.id == minutes_id)
                .values(attendees=settled)
            )


def _created_at() -> sa.Column:
    return sa.Column(
        "created_at",
        sa.DateTime(timezone=True),
        nullable=False,
        server_default=sa.func.now(),
    )


def _user_fk(name: str, nullable: bool = True) -> sa.Column:
    return sa.Column(
        name,
        sa.String(36),
        sa.ForeignKey("users.id", ondelete="SET NULL"),
        nullable=nullable,
    )


def _org_fk() -> sa.Column:
    return sa.Column(
        "organization_id",
        sa.String(36),
        sa.ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
    )


def _minutes_fk() -> sa.Column:
    return sa.Column(
        "minutes_id",
        sa.String(36),
        sa.ForeignKey(f"{MINUTES}.id", ondelete="CASCADE"),
        nullable=False,
    )


def upgrade() -> None:
    if not _has_table(MINUTES):
        return

    _settle_attendees()

    if _has_table(ITEMS):
        existing = _columns(ITEMS)
        if "carried_from_id" not in existing:
            op.add_column(
                ITEMS, sa.Column("carried_from_id", sa.String(36), nullable=True)
            )
        if "carried_forward_at" not in existing:
            op.add_column(
                ITEMS,
                sa.Column(
                    "carried_forward_at", sa.DateTime(timezone=True), nullable=True
                ),
            )
        if not _has_index(ITEMS, ITEM_IX):
            op.create_index(ITEM_IX, ITEMS, ["carried_from_id"])
        if not _has_fk(ITEMS, ITEM_FK):
            op.create_foreign_key(
                ITEM_FK,
                ITEMS,
                ITEMS,
                ["carried_from_id"],
                ["id"],
                ondelete="SET NULL",
            )

    if not _has_table(ATTACHMENTS):
        op.create_table(
            ATTACHMENTS,
            sa.Column("id", sa.String(36), primary_key=True),
            _minutes_fk(),
            _org_fk(),
            sa.Column("title", sa.String(200), nullable=False),
            sa.Column(
                "category", sa.String(30), nullable=False, server_default="other"
            ),
            sa.Column("description", sa.Text(), nullable=True),
            sa.Column("original_name", sa.String(255), nullable=False),
            sa.Column("file_path", sa.String(500), nullable=False),
            sa.Column("mime_type", sa.String(100), nullable=False),
            sa.Column("file_size", sa.Integer(), nullable=False),
            sa.Column("sha256", sa.String(64), nullable=False),
            _user_fk("uploaded_by"),
            sa.Column(
                "uploaded_at",
                sa.DateTime(timezone=True),
                nullable=False,
                server_default=sa.func.now(),
            ),
            sa.Index("ix_minutes_attachments_minutes_id", "minutes_id"),
            sa.Index("ix_minutes_attachments_organization_id", "organization_id"),
        )

    if not _has_table(RESULTS):
        op.create_table(
            RESULTS,
            sa.Column("id", sa.String(36), primary_key=True),
            _minutes_fk(),
            _org_fk(),
            sa.Column(
                "election_id",
                sa.String(36),
                sa.ForeignKey("elections.id", ondelete="SET NULL"),
                nullable=True,
            ),
            sa.Column("election_title", sa.String(300), nullable=False),
            sa.Column("election_closed_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("snapshot", sa.JSON(), nullable=False),
            _user_fk("captured_by"),
            sa.Column(
                "created_at",
                sa.DateTime(timezone=True),
                nullable=False,
                server_default=sa.func.now(),
            ),
            sa.UniqueConstraint(
                "minutes_id", "election_id", name="uq_minutes_election_results_pair"
            ),
            sa.Index("ix_minutes_election_results_minutes_id", "minutes_id"),
            sa.Index("ix_minutes_election_results_organization_id", "organization_id"),
        )

    if not _has_table(REVISIONS):
        op.create_table(
            REVISIONS,
            sa.Column("id", sa.String(36), primary_key=True),
            _minutes_fk(),
            _org_fk(),
            sa.Column("version", sa.Integer(), nullable=False),
            sa.Column("snapshot", sa.JSON(), nullable=False),
            sa.Column("content_hash", sa.String(64), nullable=False),
            _user_fk("submitted_by"),
            _user_fk("approved_by"),
            sa.Column("approved_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("superseded_at", sa.DateTime(timezone=True), nullable=True),
            _user_fk("superseded_by"),
            sa.Column("superseded_reason", sa.Text(), nullable=True),
            _created_at(),
            sa.UniqueConstraint(
                "minutes_id", "version", name="uq_minutes_revisions_version"
            ),
            sa.Index("ix_minutes_revisions_minutes_id", "minutes_id"),
            sa.Index("ix_minutes_revisions_organization_id", "organization_id"),
        )


def downgrade() -> None:
    for table in (REVISIONS, RESULTS, ATTACHMENTS):
        op.execute(sa.text(f"DROP TABLE IF EXISTS {table}"))

    if _has_table(ITEMS):
        if _has_fk(ITEMS, ITEM_FK):
            op.drop_constraint(ITEM_FK, ITEMS, type_="foreignkey")
        if _has_index(ITEMS, ITEM_IX):
            op.drop_index(ITEM_IX, table_name=ITEMS)
        existing = _columns(ITEMS)
        for name in ("carried_forward_at", "carried_from_id"):
            if name in existing:
                op.drop_column(ITEMS, name)
