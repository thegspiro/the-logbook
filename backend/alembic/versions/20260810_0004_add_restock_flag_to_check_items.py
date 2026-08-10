"""add restock_needed to check_template_items

An item used or pulled off an apparatus mid-shift had nowhere to be recorded.
The only writes to a checklist item came from an equipment check, so a crew
that used the last of something either left a note somewhere or left it for the
next morning's check to discover — which is exactly the window in which a truck
runs a call short.

restock_needed is that report, raised by whoever used the unit at the time they
used it. It shows on the supply worklist beside the expiring items and is
cleared when fresh stock is swapped in.

Revision ID: 20260810_0004
Revises: 20260810_0003
Create Date: 2026-08-10 13:00:00.000000

"""

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "20260810_0004"
down_revision = "20260810_0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "check_template_items",
        sa.Column(
            "restock_needed",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("0"),
        ),
    )
    op.add_column(
        "check_template_items",
        sa.Column("restock_reported_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "check_template_items",
        sa.Column("restock_reported_by", sa.String(length=36), nullable=True),
    )
    op.add_column(
        "check_template_items",
        sa.Column("restock_note", sa.Text(), nullable=True),
    )
    op.create_foreign_key(
        "fk_check_item_restock_reported_by",
        "check_template_items",
        "users",
        ["restock_reported_by"],
        ["id"],
        ondelete="SET NULL",
    )
    # Serves the supply worklist, which now ORs "needs restock" in beside the
    # expiring-soon window rather than scanning every checklist item.
    op.create_index(
        "idx_check_item_restock",
        "check_template_items",
        ["restock_needed"],
    )


def downgrade() -> None:
    op.drop_index("idx_check_item_restock", table_name="check_template_items")
    op.drop_constraint(
        "fk_check_item_restock_reported_by",
        "check_template_items",
        type_="foreignkey",
    )
    op.drop_column("check_template_items", "restock_note")
    op.drop_column("check_template_items", "restock_reported_by")
    op.drop_column("check_template_items", "restock_reported_at")
    op.drop_column("check_template_items", "restock_needed")
