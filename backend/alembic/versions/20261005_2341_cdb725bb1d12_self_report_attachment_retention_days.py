"""self report attachment retention days

``self_report_configs.attachment_retention_days``: how long a decided
self-reported training submission's certificate files are kept, set by the
department and read by the ``self_report_attachment_retention`` scheduled
task. NULL means keep indefinitely, the behaviour every installation had
before this column, so no backfill: an upgrade deletes nothing until a
department sets a period.

``self_report_configs`` is built by ``create_all`` and by no migration, so the
step is skipped when the table is not there yet; ``create_all`` builds it from
the model, column included. Downgrade drops the column, which only loses the
departments' chosen periods.

Revision ID: cdb725bb1d12
Revises: c56303befb2c
Create Date: 2026-10-05 23:41:43.123150

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "cdb725bb1d12"
down_revision: Union[str, None] = "c56303befb2c"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_TABLE = "self_report_configs"
_COLUMN = "attachment_retention_days"


def _columns() -> set:
    inspector = sa.inspect(op.get_bind())
    if _TABLE not in inspector.get_table_names():
        return set()
    return {c["name"] for c in inspector.get_columns(_TABLE)}


def upgrade() -> None:
    columns = _columns()
    if not columns or _COLUMN in columns:
        return
    op.add_column(_TABLE, sa.Column(_COLUMN, sa.Integer(), nullable=True))


def downgrade() -> None:
    if _COLUMN in _columns():
        op.drop_column(_TABLE, _COLUMN)
