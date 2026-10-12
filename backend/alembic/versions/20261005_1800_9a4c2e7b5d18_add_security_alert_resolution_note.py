"""add security_alerts.resolution_note

SEC2-28-7: security alerts gain an admin screen where an officer acknowledges
and resolves them. Resolving records what the officer found, and that note is
kept on the alert itself beside resolved_by/resolved_at so the alert reads as
a complete record without cross-referencing the audit log. Nullable: every
existing alert, and any alert resolved without a note, has none. The
downgrade drops it; nothing before this revision reads it.

Revision ID: 9a4c2e7b5d18
Revises: f7c09cfec5b0
Create Date: 2026-10-05 18:00:00

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "9a4c2e7b5d18"
down_revision: Union[str, None] = "f7c09cfec5b0"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_TABLE = "security_alerts"
_COLUMN = "resolution_note"


def _columns() -> set:
    inspector = sa.inspect(op.get_bind())
    if _TABLE not in inspector.get_table_names():
        return set()
    return {c["name"] for c in inspector.get_columns(_TABLE)}


def upgrade() -> None:
    columns = _columns()
    # No table: create_all builds it later from the model, column included.
    if not columns or _COLUMN in columns:
        return
    op.add_column(_TABLE, sa.Column(_COLUMN, sa.Text(), nullable=True))


def downgrade() -> None:
    if _COLUMN in _columns():
        op.drop_column(_TABLE, _COLUMN)
