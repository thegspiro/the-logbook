"""Minutes section motions

A section an outline marks "needs a motion" now has its motion record from the
day the minutes are made, so the secretary records who moved and the vote
rather than building the motion. That needs three things:

* ``meeting_motions.status`` gains ``pending``: the motion is prepared and the
  meeting has not acted on it. A pending motion is wording only and is never
  printed, published, posted or sealed into an adopted record.
* ``meeting_motions.previous_minutes_id``: for the motion that accepts the
  previous meeting's minutes, those minutes. SET NULL if they are deleted.
* ``meeting_motions.acceptance``: ``as_submitted`` or ``as_revised``.

Nothing is backfilled: motions already recorded keep their result, and minutes
already made get their prepared motions when next edited. This revision also
merges the three heads ``main`` carried when it was written.

Each step is skipped when ``meeting_motions`` is not there yet (``create_all``
builds it from the model, which already declares all of this) or the change is
already made. The downgrade deletes pending motions first, since they carry no
record and the shorter enum could not hold them, then drops the two columns.

Revision ID: 751a14709cc4
Revises: 6dc58d6997df, 7e5d6cf3292c, e99f068be43e
Create Date: 2026-10-18 21:52:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "751a14709cc4"
# fmt: off
down_revision: Union[str, Sequence[str], None] = ("6dc58d6997df", "7e5d6cf3292c", "e99f068be43e")
# fmt: on
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

TABLE = "meeting_motions"
FK = "fk_meeting_motions_previous_minutes_id_meeting_minutes"
OLD = ("passed", "failed", "tabled", "withdrawn")
NEW = ("pending",) + OLD


def _state():
    inspector = sa.inspect(op.get_bind())
    if TABLE not in inspector.get_table_names():
        return None
    columns = {c["name"] for c in inspector.get_columns(TABLE)}
    fks = {fk["name"] for fk in inspector.get_foreign_keys(TABLE)}
    return columns, fks


def _status_enum(values):
    return sa.Enum(*values, name="motionstatus")


def _status_allows_pending() -> bool:
    inspector = sa.inspect(op.get_bind())
    for column in inspector.get_columns(TABLE):
        if column["name"] == "status":
            return "pending" in (getattr(column["type"], "enums", None) or ())
    return True


def upgrade() -> None:
    state = _state()
    if state is None:
        return
    columns, fks = state

    if not _status_allows_pending():
        op.alter_column(
            TABLE,
            "status",
            existing_type=_status_enum(OLD),
            type_=_status_enum(NEW),
            existing_nullable=False,
            existing_server_default="passed",
        )
    if "previous_minutes_id" not in columns:
        op.add_column(
            TABLE, sa.Column("previous_minutes_id", sa.String(36), nullable=True)
        )
    if FK not in fks and {"meeting_minutes"} <= set(
        sa.inspect(op.get_bind()).get_table_names()
    ):
        op.create_foreign_key(
            FK,
            TABLE,
            "meeting_minutes",
            ["previous_minutes_id"],
            ["id"],
            ondelete="SET NULL",
        )
    if "acceptance" not in columns:
        op.add_column(TABLE, sa.Column("acceptance", sa.String(20), nullable=True))


def downgrade() -> None:
    state = _state()
    if state is None:
        return
    columns, fks = state

    if _status_allows_pending():
        op.execute(sa.text(f"DELETE FROM {TABLE} WHERE status = 'pending'"))
        op.alter_column(
            TABLE,
            "status",
            existing_type=_status_enum(NEW),
            type_=_status_enum(OLD),
            existing_nullable=False,
            existing_server_default="passed",
        )
    if FK in fks:
        op.drop_constraint(FK, TABLE, type_="foreignkey")
    if "previous_minutes_id" in columns:
        op.drop_column(TABLE, "previous_minutes_id")
    if "acceptance" in columns:
        op.drop_column(TABLE, "acceptance")
