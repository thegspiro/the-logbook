"""add pipeline conversion outcomes

Adds ``membership_pipelines.conversion_config``: what class and status an
applicant becomes when the pipeline converts them to a member, per applicant
track, e.g. administrative applicants become regular administrative members
while operational applicants become probationary operational members.

Nullable, with no backfill. NULL means the pipeline has not chosen, and
conversion then uses the defaults in ``app.schemas.membership_pipeline``, which
are the outcomes the manual Convert dialog already produced. So an existing
pipeline converts exactly as before until someone saves the setting.

Downgrade drops the column, and with it any outcomes departments configured;
conversion falls back to the pre-setting behaviour.

Revision ID: 601fdb28ab8c
Revises: 31027aabca12
Create Date: 2026-09-30 01:11:41.832659

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "601fdb28ab8c"
down_revision: Union[str, None] = "31027aabca12"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


TABLE = "membership_pipelines"
COLUMN = "conversion_config"


def _has_table(table: str) -> bool:
    return table in sa.inspect(op.get_bind()).get_table_names()


def _has_column(table: str, column: str) -> bool:
    inspector = sa.inspect(op.get_bind())
    return column in {c["name"] for c in inspector.get_columns(table)}


def upgrade() -> None:
    # Guarded on the table and on the column's absence: create_all or
    # scripts/repair_schema.py may already have built either from the model.
    if _has_table(TABLE) and not _has_column(TABLE, COLUMN):
        op.add_column(TABLE, sa.Column(COLUMN, sa.JSON(), nullable=True))


def downgrade() -> None:
    if _has_table(TABLE) and _has_column(TABLE, COLUMN):
        op.drop_column(TABLE, COLUMN)
