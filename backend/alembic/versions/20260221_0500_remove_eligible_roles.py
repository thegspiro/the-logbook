"""Remove eligible_roles from events and event_templates

Revision ID: 20260221_0500
Revises: 20260221_0400
Create Date: 2026-02-21 05:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "20260221_0500"
down_revision: Union[str, None] = "20260221_0400"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_column("events", "eligible_roles")
    op.drop_column("event_templates", "eligible_roles")


def downgrade() -> None:
    op.add_column("event_templates", sa.Column("eligible_roles", sa.JSON(), nullable=True))
    op.add_column("events", sa.Column("eligible_roles", sa.JSON(), nullable=True))
