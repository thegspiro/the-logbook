"""Let a shift-credited requirement count time in one seat only

- ``training_requirements.credited_seat``: when set, a shift-credited Hours or
  Shifts requirement counts only the shifts the member held that seat on
  (owner decisions, 2026-11-26). Nullable; NULL means every shift counts.

Existing rows: the column is added as NULL, so every requirement keeps
counting exactly what it counted before.

Downgrade drops the column; which requirements were limited to a seat is lost
on the way down, and those requirements count every shift again.

Revision ID: 103bffdb9528
Revises: e9cf8ab7e4e4
Create Date: 2026-11-26 06:05:00

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "103bffdb9528"
down_revision: Union[str, None] = "e9cf8ab7e4e4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

REQUIREMENTS = "training_requirements"
COLUMN = "credited_seat"


def _has_table(bind, table: str) -> bool:
    return (
        bind.execute(
            sa.text(
                "SELECT COUNT(*) FROM information_schema.TABLES "
                "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :table"
            ),
            {"table": table},
        ).scalar()
        > 0
    )


def _has_column(bind, table: str, column: str) -> bool:
    return (
        bind.execute(
            sa.text(
                "SELECT COUNT(*) FROM information_schema.COLUMNS "
                "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :table "
                "AND COLUMN_NAME = :column"
            ),
            {"table": table, "column": column},
        ).scalar()
        > 0
    )


def upgrade() -> None:
    bind = op.get_bind()
    # No requirements table: create_all builds it from the model later, the
    # new column included.
    if not _has_table(bind, REQUIREMENTS):
        return
    if not _has_column(bind, REQUIREMENTS, COLUMN):
        op.add_column(
            REQUIREMENTS,
            sa.Column(COLUMN, sa.String(100), nullable=True),
        )


def downgrade() -> None:
    bind = op.get_bind()
    if _has_table(bind, REQUIREMENTS) and _has_column(bind, REQUIREMENTS, COLUMN):
        op.drop_column(REQUIREMENTS, COLUMN)
