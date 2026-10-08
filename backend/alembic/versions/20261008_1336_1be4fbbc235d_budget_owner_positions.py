"""Add owner_position_id to budget_categories and budgets.

Revision ID: 1be4fbbc235d
Revises: 7db20aa49329
Create Date: 2026-10-08 13:36:36.252377

A budget line is owned by a **position** (owner decision, 2026-10-08). A
category may name an owner position too, and a line with no owner of its own
inherits its category's; the line's own owner overrides it. Both columns are
nullable and start empty, so no installation changes behaviour on upgrade —
every existing line simply has no owner until the Treasurer assigns one.

The key is ``ondelete="SET NULL"`` (and therefore nullable, CLAUDE.md pitfall
#2): deleting a position leaves its lines unowned rather than deleting money.

Both tables are built by ``create_all()`` and by no migration (CLAUDE.md
pitfall #26), so each step is guarded on the table existing; a table built
later comes from the models, which already declare the column. Each step is
also guarded on the column, key and index being absent, so a database that
already carries them is left alone. The names match the models' naming
convention, so the downgrade finds them however the table was built.

**Downgrade** drops the key, the index and the column on both tables. Owner
assignments made since are lost; nothing else reads them.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "1be4fbbc235d"
down_revision: Union[str, None] = "7db20aa49329"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

COLUMN = "owner_position_id"
TABLES = (
    (
        "budget_categories",
        "fk_budget_categories_owner_position_id_positions",
        "ix_budget_categories_owner_position_id",
    ),
    (
        "budgets",
        "fk_budgets_owner_position_id_positions",
        "ix_budgets_owner_position_id",
    ),
)


def _inspector():
    return sa.inspect(op.get_bind())


def _has_table(table: str) -> bool:
    return table in _inspector().get_table_names()


def _has_column(table: str, column: str) -> bool:
    return column in {c["name"] for c in _inspector().get_columns(table)}


def _has_index(table: str, name: str) -> bool:
    return name in {i["name"] for i in _inspector().get_indexes(table)}


def _foreign_key_names(table: str, column: str) -> list:
    return [
        fk["name"]
        for fk in _inspector().get_foreign_keys(table)
        if fk.get("name") and fk.get("constrained_columns") == [column]
    ]


def upgrade() -> None:
    for table, fk_name, index_name in TABLES:
        # No table: create_all builds it later from the model, column included.
        if not _has_table(table):
            continue
        if not _has_column(table, COLUMN):
            op.add_column(table, sa.Column(COLUMN, sa.String(36), nullable=True))
        # The index before the key: MySQL gives a key with no usable index
        # one of its own, which would leave the column indexed twice.
        if not _has_index(table, index_name):
            op.create_index(index_name, table, [COLUMN])
        if not _foreign_key_names(table, COLUMN):
            op.create_foreign_key(
                fk_name, table, "positions", [COLUMN], ["id"], ondelete="SET NULL"
            )


def downgrade() -> None:
    for table, _fk_name, index_name in reversed(TABLES):
        if not _has_table(table) or not _has_column(table, COLUMN):
            continue
        # The foreign key goes first: MySQL refuses to drop an index a
        # constraint still depends on.
        for name in _foreign_key_names(table, COLUMN):
            op.drop_constraint(name, table, type_="foreignkey")
        if _has_index(table, index_name):
            op.drop_index(index_name, table_name=table)
        op.drop_column(table, COLUMN)
