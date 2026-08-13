"""Add ballots_cast to manual_ballot_batches

Paper tallies record per-candidate counts, not ballot-level groupings, so
for multi-vote methods (approval, ranked choice) the number of voters a
batch represents could only be estimated as a lower bound — ten approval
ballots split 5/5 across two candidates counted as five voters, and a
percentage quorum could wrongly void winners. The recording officer can
now attest the number of physical ballots in the batch; the turnout
calculation prefers it over the estimate. Nullable: batches recorded
before this column exists simply keep the estimate.

Revision ID: 20260813_0004
Revises: 20260813_0003
Create Date: 2026-08-13 00:02:00.000000
"""

import sqlalchemy as sa
from alembic import op

# revision identifiers
revision = "20260813_0004"
down_revision = "20260813_0003"
branch_labels = None
depends_on = None

_TABLE = "manual_ballot_batches"
_COLUMN = "ballots_cast"


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    if _TABLE not in inspector.get_table_names():
        # Fresh installs materialize the table from the model (which already
        # carries the column) after migrations run.
        return
    columns = {column["name"] for column in inspector.get_columns(_TABLE)}
    if _COLUMN not in columns:
        op.add_column(_TABLE, sa.Column(_COLUMN, sa.Integer(), nullable=True))


def downgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    if _TABLE not in inspector.get_table_names():
        return
    columns = {column["name"] for column in inspector.get_columns(_TABLE)}
    if _COLUMN in columns:
        op.drop_column(_TABLE, _COLUMN)
