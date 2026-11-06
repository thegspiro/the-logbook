"""Finance approvals: when a step's approvers were emailed that it reached them

Revision ID: 50c94d5c30f8
Revises: 100121b59d94
Create Date: 2026-11-06 04:34:17.622016

Adds ``approvers_notified_at`` to ``approval_step_records`` (owner decision
2026-11-01, KNOWN_LIMITATIONS "Finance — Purchase Requests: Named Approvers,
Notices and the Paid Amount"): the members a step names are emailed when a
request reaches it, and the stamp is what keeps a second run of the advance
from emailing them again.

Existing rows stay NULL. A step already waiting when this runs was reached
before the notice existed; it is not emailed retroactively, because the
advance only notifies a step at the moment it becomes the current one, and
those steps already are. Nothing is rewritten, so there is nothing to reverse.

``approval_step_records`` is built by ``create_all`` and by no migration, so
the step is skipped when the table is absent (CLAUDE.md pitfall #26): the
table is then built from the model, which declares the column. It is added
only when missing, so a re-run is a no-op. The downgrade drops it; the
previous release does not read it.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "50c94d5c30f8"
down_revision: Union[str, None] = "100121b59d94"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

TABLE = "approval_step_records"
COLUMN = "approvers_notified_at"


def _columns() -> set[str]:
    inspector = sa.inspect(op.get_bind())
    if TABLE not in inspector.get_table_names():
        return set()
    return {c["name"] for c in inspector.get_columns(TABLE)}


def upgrade() -> None:
    columns = _columns()
    if columns and COLUMN not in columns:
        op.add_column(
            TABLE, sa.Column(COLUMN, sa.DateTime(timezone=True), nullable=True)
        )


def downgrade() -> None:
    if COLUMN in _columns():
        op.drop_column(TABLE, COLUMN)
