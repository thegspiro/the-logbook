"""Record legal-document reverts and edits to someone else's proposal

Owner decisions of 2026-11-01 (``docs/KNOWN_LIMITATIONS.md``, "Legal Documents
— History, Attribution and Formatting Gaps", W54-3 and W54-4):

1. ``reverts_to_default`` marks a history row that records "the built-in text
   was restored" — who did it (``published_by``) and when (``published_at``).
   A revert is a row in the same history list rather than a pair of
   "replaced at / by" columns because a revert can happen when no row is
   live at all (text configured in settings before this screen existed), and
   only a row of its own can record that.
2. ``edited_by`` / ``edited_at`` record a publisher editing a proposal that
   someone else made, without taking the proposer's name off it.

Existing rows: all three columns arrive empty or false, which is exactly true
of every row already stored — no existing revision is a revert, and no edit
was ever attributed, so there is nothing to backfill and nothing to guess.
``reverts_to_default`` is NOT NULL with a server default, so the rows already
there get ``0`` from the default rather than from the implicit-default path
pitfall #35 warns about. ``edited_by`` is a nullable SET NULL foreign key
(pitfall #2) on a column that holds no values yet, so no existing row can be
an orphan.

The table is created by ``20260820_0135_06adc68a8b84`` behind its own
existence guard, so every step here is guarded on it too.

Revision ID: 81b38694152f
Revises: f4583df5025b
Create Date: 2026-11-05 12:20:18.978918

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "81b38694152f"
down_revision: Union[str, None] = "f4583df5025b"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_TABLE = "legal_document_revisions"
_EDITED_BY_FK = "fk_legal_document_revisions_edited_by_users"


def _columns() -> set[str] | None:
    inspector = sa.inspect(op.get_bind())
    if _TABLE not in inspector.get_table_names():
        return None
    return {c["name"] for c in inspector.get_columns(_TABLE)}


def upgrade() -> None:
    columns = _columns()
    if columns is None:
        return
    if "reverts_to_default" not in columns:
        op.add_column(
            _TABLE,
            sa.Column(
                "reverts_to_default",
                sa.Boolean(),
                nullable=False,
                server_default=sa.false(),
            ),
        )
    if "edited_by" not in columns:
        op.add_column(
            _TABLE, sa.Column("edited_by", sa.String(length=36), nullable=True)
        )
        op.create_foreign_key(
            _EDITED_BY_FK,
            _TABLE,
            "users",
            ["edited_by"],
            ["id"],
            ondelete="SET NULL",
        )
    if "edited_at" not in columns:
        op.add_column(
            _TABLE, sa.Column("edited_at", sa.DateTime(timezone=True), nullable=True)
        )


def downgrade() -> None:
    # Dropping reverts_to_default would leave each revert row reading as an
    # ordinary archived revision with an empty body, so the rows are removed
    # with the column: before this revision the history had no way to show a
    # revert, and the audit log (legal.document_reverted_to_default) still
    # records each one.
    columns = _columns()
    if columns is None:
        return
    if "edited_at" in columns:
        op.drop_column(_TABLE, "edited_at")
    if "edited_by" in columns:
        fks = {
            fk["name"]
            for fk in sa.inspect(op.get_bind()).get_foreign_keys(_TABLE)
            if fk.get("constrained_columns") == ["edited_by"]
        }
        for name in fks:
            if name:
                op.drop_constraint(name, _TABLE, type_="foreignkey")
        op.drop_column(_TABLE, "edited_by")
    if "reverts_to_default" in columns:
        op.execute(sa.text(f"DELETE FROM {_TABLE} WHERE reverts_to_default = 1"))
        op.drop_column(_TABLE, "reverts_to_default")
