"""Add missing DEFAULT CURRENT_TIMESTAMP to election datetime columns

The election models declare ``server_default=func.now()`` on their NOT NULL
datetime columns, but 20260118_0004 / 20260119_0006 created the tables with
no DB-level default. ORM INSERTs omit server-defaulted columns entirely, so
every service-created row (runoff elections, write-in candidates, votes)
fails with MySQL error 1364 on a chain-built database. create_all()-built
deployments already carry these defaults.

Revision ID: 20260801_0003
Revises: 20260801_0002
Create Date: 2026-08-01 00:03:00.000000
"""

import sqlalchemy as sa

from alembic import op

# revision identifiers
revision = "20260801_0003"
down_revision = "20260801_0002"
branch_labels = None
depends_on = None

_COLUMNS = [
    ("elections", "created_at"),
    ("elections", "updated_at"),
    ("candidates", "nomination_date"),
    ("candidates", "created_at"),
    ("candidates", "updated_at"),
    ("votes", "voted_at"),
    ("voting_tokens", "created_at"),
]


def upgrade() -> None:
    for table, column in _COLUMNS:
        op.alter_column(
            table,
            column,
            existing_type=sa.DateTime(),
            existing_nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        )


def downgrade() -> None:
    for table, column in _COLUMNS:
        op.alter_column(
            table,
            column,
            existing_type=sa.DateTime(),
            existing_nullable=False,
            server_default=None,
        )
