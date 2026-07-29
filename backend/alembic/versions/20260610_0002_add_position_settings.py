"""Add settings JSON to positions for per-position UI preferences

Stores per-position preferences such as the inventory label printer/size a
role uses (so a Quartermaster keeps a Rollo, Training keeps a Dymo, etc.,
independent of which computer is used).

Revision ID: 20260610_0002
Revises: 20260610_0001
Create Date: 2026-06-10 01:00:00.000000

"""

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "20260610_0002"
down_revision = "20260610_0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # positions is a model-only table (the chain created roles/user_roles;
    # deployments materialize positions via create_all, which already
    # includes settings). On a fresh chain run there is nothing to alter.
    from sqlalchemy import inspect

    if "positions" not in inspect(op.get_bind()).get_table_names():
        return

    op.add_column("positions", sa.Column("settings", sa.JSON(), nullable=True))


def downgrade() -> None:
    op.drop_column("positions", "settings")
