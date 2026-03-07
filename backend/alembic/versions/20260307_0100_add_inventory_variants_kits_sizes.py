"""add variant groups, equipment kits, member size preferences, and new item fields

Revision ID: 20260307_0100
Revises: 20260306_0501
Create Date: 2026-03-07 01:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "20260307_0100"
down_revision = "20260306_0501"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ---- item_variant_groups table ----
    op.create_table(
        "item_variant_groups",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "organization_id",
            sa.String(36),
            sa.ForeignKey("organizations.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column(
            "category_id",
            sa.String(36),
            sa.ForeignKey("inventory_categories.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("base_price", sa.Numeric(10, 2), nullable=True),
        sa.Column("base_replacement_cost", sa.Numeric(10, 2), nullable=True),
        sa.Column("unit_of_measure", sa.String(50), nullable=True),
        sa.Column("active", sa.Boolean(), server_default="1", nullable=False),
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
        sa.Column("created_by", sa.String(36), sa.ForeignKey("users.id"), nullable=True),
    )
    op.create_index(
        "idx_variant_groups_org_active",
        "item_variant_groups",
        ["organization_id", "active"],
    )

    # ---- New columns on inventory_items ----
    op.add_column(
        "inventory_items",
        sa.Column(
            "standard_size",
            sa.Enum(
                "xxs", "xs", "s", "m", "l", "xl", "xxl", "xxxl", "xxxxl",
                "6", "6.5", "7", "7.5", "8", "8.5", "9", "9.5", "10", "10.5",
                "11", "11.5", "12", "12.5", "13", "14", "15",
                "28", "30", "32", "34", "36", "38", "40", "42", "44", "46",
                "one_size", "custom",
                name="standardsize",
            ),
            nullable=True,
        ),
    )
    op.add_column(
        "inventory_items",
        sa.Column(
            "style",
            sa.Enum(
                "short_sleeve", "long_sleeve", "mens", "womens", "unisex",
                "v_neck", "crew_neck", "polo", "button_down", "quarter_zip",
                name="garmentstyle",
            ),
            nullable=True,
        ),
    )
    op.add_column(
        "inventory_items",
        sa.Column(
            "variant_group_id",
            sa.String(36),
            sa.ForeignKey("item_variant_groups.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.create_index(
        "idx_inventory_items_variant_group",
        "inventory_items",
        ["variant_group_id"],
    )

    # ---- Convert string columns to enums ----
    # charge_status on item_issuances
    op.alter_column(
        "item_issuances",
        "charge_status",
        type_=sa.Enum("none", "pending", "charged", "waived", name="chargestatus"),
        existing_type=sa.String(50),
        existing_nullable=True,
        existing_server_default="none",
    )

    # departure_type on departure_clearances
    op.alter_column(
        "departure_clearances",
        "departure_type",
        type_=sa.Enum(
            "dropped_voluntary", "dropped_involuntary", "retired",
            name="departuretype",
        ),
        existing_type=sa.String(50),
        existing_nullable=True,
    )

    # reason on inventory_write_offs
    op.alter_column(
        "inventory_write_offs",
        "reason",
        type_=sa.Enum(
            "lost", "damaged_beyond_repair", "obsolete", "stolen", "other",
            name="writeoffreason",
        ),
        existing_type=sa.String(50),
        existing_nullable=False,
    )

    # recommendation on nfpa_inspection_details
    op.alter_column(
        "nfpa_inspection_details",
        "recommendation",
        type_=sa.Enum(
            "pass", "repair", "advanced_cleaning", "retire",
            name="nfparecommendation",
        ),
        existing_type=sa.String(50),
        existing_nullable=True,
    )

    # ---- equipment_kits table ----
    op.create_table(
        "equipment_kits",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "organization_id",
            sa.String(36),
            sa.ForeignKey("organizations.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("restricted_to_roles", sa.JSON(), nullable=True),
        sa.Column("min_rank_order", sa.Integer(), nullable=True),
        sa.Column("active", sa.Boolean(), server_default="1", nullable=False),
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
        sa.Column("created_by", sa.String(36), sa.ForeignKey("users.id"), nullable=True),
    )
    op.create_index(
        "idx_kits_org_active",
        "equipment_kits",
        ["organization_id", "active"],
    )

    # ---- equipment_kit_items table ----
    op.create_table(
        "equipment_kit_items",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "kit_id",
            sa.String(36),
            sa.ForeignKey("equipment_kits.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "item_id",
            sa.String(36),
            sa.ForeignKey("inventory_items.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "category_id",
            sa.String(36),
            sa.ForeignKey("inventory_categories.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("item_name", sa.String(255), nullable=False),
        sa.Column("quantity", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("size_selectable", sa.Boolean(), server_default="0", nullable=False),
        sa.Column("sort_order", sa.Integer(), server_default="0", nullable=False),
    )
    op.create_index("idx_kit_items_kit", "equipment_kit_items", ["kit_id"])

    # ---- member_size_preferences table ----
    op.create_table(
        "member_size_preferences",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "user_id",
            sa.String(36),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
            unique=True,
            index=True,
        ),
        sa.Column(
            "organization_id",
            sa.String(36),
            sa.ForeignKey("organizations.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("shirt_size", sa.String(20), nullable=True),
        sa.Column("shirt_style", sa.String(30), nullable=True),
        sa.Column("pant_waist", sa.String(10), nullable=True),
        sa.Column("pant_inseam", sa.String(10), nullable=True),
        sa.Column("jacket_size", sa.String(20), nullable=True),
        sa.Column("boot_size", sa.String(10), nullable=True),
        sa.Column("boot_width", sa.String(10), nullable=True),
        sa.Column("glove_size", sa.String(10), nullable=True),
        sa.Column("hat_size", sa.String(10), nullable=True),
        sa.Column("custom_sizes", sa.JSON(), nullable=True),
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
    )
    op.create_index(
        "idx_member_sizes_org",
        "member_size_preferences",
        ["organization_id"],
    )


def downgrade() -> None:
    op.drop_table("member_size_preferences")
    op.drop_table("equipment_kit_items")
    op.drop_table("equipment_kits")

    # Revert enum columns back to strings
    op.alter_column(
        "nfpa_inspection_details",
        "recommendation",
        type_=sa.String(50),
        existing_nullable=True,
    )
    op.alter_column(
        "inventory_write_offs",
        "reason",
        type_=sa.String(50),
        existing_nullable=False,
    )
    op.alter_column(
        "departure_clearances",
        "departure_type",
        type_=sa.String(50),
        existing_nullable=True,
    )
    op.alter_column(
        "item_issuances",
        "charge_status",
        type_=sa.String(50),
        existing_nullable=True,
        existing_server_default="none",
    )

    op.drop_index("idx_inventory_items_variant_group", table_name="inventory_items")
    op.drop_column("inventory_items", "variant_group_id")
    op.drop_column("inventory_items", "style")
    op.drop_column("inventory_items", "standard_size")
    op.drop_table("item_variant_groups")
