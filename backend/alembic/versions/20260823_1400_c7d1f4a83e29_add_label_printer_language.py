"""Add the command language a label printer speaks.

Separates ZPL (Zebra and the many printers with ZPL emulation) from ESC/POS
(receipt-class thermal printers, several of which take linerless label media).
The renderer, the stock sizes offered, and the status query all branch on it.

Existing rows are ZPL: that is the only language that existed when they were
created, so the default is a statement of fact rather than a guess.

Revision ID: c7d1f4a83e29
Revises: b3e7f1a92c40
"""

import sqlalchemy as sa
from alembic import op

revision = "c7d1f4a83e29"
down_revision = "b3e7f1a92c40"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "label_printers",
        sa.Column(
            "language",
            sa.String(20),
            nullable=False,
            server_default="zpl",
        ),
    )


def downgrade() -> None:
    op.drop_column("label_printers", "language")
