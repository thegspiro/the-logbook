"""Add store payment policy (when an unpaid order may move forward)

Departments differ on whether an unpaid order goes to the vendor at all, goes
but cannot be collected, or is simply not gated. Defaults to `none`, which is
what every existing store already does.

Revision ID: 20260802_0006
Revises: 20260802_0005
Create Date: 2026-08-05
"""

import sqlalchemy as sa
from alembic import op

# revision identifiers
revision = "20260802_0006"
down_revision = "20260802_0005"
branch_labels = None
depends_on = None


PAYMENT_POLICY = ("none", "before_pickup", "before_vendor_order")


def upgrade() -> None:
    op.add_column(
        "store_settings",
        sa.Column(
            "payment_policy",
            sa.Enum(*PAYMENT_POLICY, name="storepaymentpolicy"),
            nullable=False,
            server_default="none",
        ),
    )


def downgrade() -> None:
    op.drop_column("store_settings", "payment_policy")
