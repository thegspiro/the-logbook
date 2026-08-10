"""add check_item_deployed_lots

A checklist position that carries four of something can be carrying units from
several lots with several expiration dates. CheckTemplateItem holds one
lot_number and one expiration_date, so only one of them could be recorded: the
truck's real exposure — the soonest date aboard — was unrepresentable, and
restocking a partial shortfall overwrote the date of the units already there
with the date of the ones just added.

Each row here is one lot's presence on one position. The position's on-truck
count becomes the sum of these, and its expiration the earliest of them.

Existing single-lot data is migrated across: any item carrying a lot number or
expiration becomes one deployed-lot row, so nothing already recorded is lost
and the derived count matches what the item reported before.

Revision ID: 20260810_0008
Revises: 20260810_0007
Create Date: 2026-08-10 15:00:00.000000

"""

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "20260810_0008"
down_revision = "20260810_0007"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "check_item_deployed_lots",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("organization_id", sa.String(length=36), nullable=False),
        sa.Column("template_item_id", sa.String(length=36), nullable=False),
        sa.Column("inventory_lot_id", sa.String(length=36), nullable=True),
        sa.Column("lot_number", sa.String(length=100), nullable=True),
        sa.Column("expiration_date", sa.Date(), nullable=True),
        sa.Column(
            "quantity", sa.Integer(), nullable=False, server_default=sa.text("0")
        ),
        sa.Column(
            "deployed_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
        ),
        sa.Column("deployed_by", sa.String(length=36), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
        ),
        sa.ForeignKeyConstraint(
            ["organization_id"], ["organizations.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["template_item_id"], ["check_template_items.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["inventory_lot_id"], ["inventory_lots.id"], ondelete="SET NULL"
        ),
        sa.ForeignKeyConstraint(["deployed_by"], ["users.id"], ondelete="SET NULL"),
    )
    op.create_index(
        "idx_deployed_lot_org", "check_item_deployed_lots", ["organization_id"]
    )
    op.create_index(
        "idx_deployed_lot_item", "check_item_deployed_lots", ["template_item_id"]
    )
    op.create_index(
        "idx_deployed_lot_item_exp",
        "check_item_deployed_lots",
        ["template_item_id", "expiration_date"],
    )

    # Carry the existing single lot across so no recorded date is lost and the
    # derived count matches what each item reported before this change. The
    # quantity is the item's live count where it has one, else its target —
    # the same fallback the application uses for an uncounted position.
    op.execute("""
        INSERT INTO check_item_deployed_lots (
            id, organization_id, template_item_id, lot_number,
            expiration_date, quantity, deployed_at, created_at, updated_at
        )
        SELECT
            UUID(),
            t.organization_id,
            i.id,
            i.lot_number,
            CASE WHEN i.has_expiration THEN i.expiration_date ELSE NULL END,
            COALESCE(
                i.quantity_on_truck, i.required_quantity, i.expected_quantity, 1
            ),
            NOW(), NOW(), NOW()
        FROM check_template_items i
        JOIN check_template_compartments c ON c.id = i.compartment_id
        JOIN equipment_check_templates t ON t.id = c.template_id
        WHERE i.lot_number IS NOT NULL
           OR (i.has_expiration = 1 AND i.expiration_date IS NOT NULL)
        """)


def downgrade() -> None:
    op.drop_index("idx_deployed_lot_item_exp", table_name="check_item_deployed_lots")
    op.drop_index("idx_deployed_lot_item", table_name="check_item_deployed_lots")
    op.drop_index("idx_deployed_lot_org", table_name="check_item_deployed_lots")
    op.drop_table("check_item_deployed_lots")
