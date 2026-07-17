"""Add inventory lots (ready stock) and link check items to inventory

Introduces inventory_lots so consumables can be stocked as ready
replacements (lot number + expiration + quantity), and links check
template items to the inventory catalog so those replacements can be
swapped onto apparatus during equipment checks.

Revision ID: 20260724_0001
Revises: 20260723_0001
Create Date: 2026-07-17 00:00:00.000000

"""

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "20260724_0001"
down_revision = "20260723_0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "inventory_lots",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("organization_id", sa.String(length=36), nullable=False),
        sa.Column("inventory_item_id", sa.String(length=36), nullable=False),
        sa.Column("lot_number", sa.String(length=100), nullable=True),
        sa.Column("expiration_date", sa.Date(), nullable=True),
        sa.Column("quantity", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("received_date", sa.Date(), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=True,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=True,
        ),
        sa.Column("created_by", sa.String(length=36), nullable=True),
        sa.ForeignKeyConstraint(
            ["organization_id"], ["organizations.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["inventory_item_id"], ["inventory_items.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["created_by"], ["users.id"], ondelete="SET NULL"
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "idx_inventory_lots_org_exp",
        "inventory_lots",
        ["organization_id", "expiration_date"],
    )
    op.create_index(
        "ix_inventory_lots_organization_id", "inventory_lots", ["organization_id"]
    )
    op.create_index(
        "ix_inventory_lots_inventory_item_id",
        "inventory_lots",
        ["inventory_item_id"],
    )

    op.add_column(
        "check_template_items",
        sa.Column("inventory_item_id", sa.String(length=36), nullable=True),
    )
    op.create_foreign_key(
        "fk_check_item_inventory_item",
        "check_template_items",
        "inventory_items",
        ["inventory_item_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index(
        "idx_check_item_inventory",
        "check_template_items",
        ["inventory_item_id"],
    )


def downgrade() -> None:
    op.drop_index("idx_check_item_inventory", table_name="check_template_items")
    op.drop_constraint(
        "fk_check_item_inventory_item",
        "check_template_items",
        type_="foreignkey",
    )
    op.drop_column("check_template_items", "inventory_item_id")

    op.drop_index("ix_inventory_lots_inventory_item_id", table_name="inventory_lots")
    op.drop_index("ix_inventory_lots_organization_id", table_name="inventory_lots")
    op.drop_index("idx_inventory_lots_org_exp", table_name="inventory_lots")
    op.drop_table("inventory_lots")
