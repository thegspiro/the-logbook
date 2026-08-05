"""Give every storefront notice its own switch

Four of the module's notices — payment receipts, window opened, closing soon,
window closed — and the vendor-order update had no setting behind them. They
were governed only by a per-send checkbox, so a department that did not want
them had to remember to untick a box every time, and the settings screen
listed three notices while the module actually sent ten.

Every new switch defaults on, matching the behaviour these notices had before
this migration: nothing a department is receiving today stops arriving.

Revision ID: 20260802_0009
Revises: 20260802_0008
Create Date: 2026-08-05
"""

import sqlalchemy as sa

from alembic import op

# revision identifiers
revision = "20260802_0009"
down_revision = "20260802_0008"
branch_labels = None
depends_on = None

_COLUMNS = (
    "send_payment_receipts",
    "send_window_opened",
    "send_window_closing_reminder",
    "send_window_closed",
    "send_vendor_order_updates",
)


def upgrade() -> None:
    for name in _COLUMNS:
        op.add_column(
            "store_settings",
            sa.Column(
                name,
                sa.Boolean(),
                nullable=False,
                server_default=sa.text("1"),
            ),
        )


def downgrade() -> None:
    for name in reversed(_COLUMNS):
        op.drop_column("store_settings", name)
