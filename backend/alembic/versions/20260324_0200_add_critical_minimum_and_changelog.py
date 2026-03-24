"""Add critical_minimum_quantity and template_change_logs table

Adds a critical minimum threshold for quantity check items so departments
can configure when low stock triggers alerts vs. just warnings.
Also creates a granular changelog table for template edit auditing.

Revision ID: 20260324_0200
Revises: 20260324_0100
Create Date: 2026-03-24
"""

from alembic import op
import sqlalchemy as sa


# revision identifiers
revision = "20260324_0200"
down_revision = "20260324_0100"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "check_template_items",
        sa.Column("critical_minimum_quantity", sa.Integer(), nullable=True),
    )

    op.add_column(
        "shift_equipment_check_items",
        sa.Column("critical_minimum_quantity", sa.Integer(), nullable=True),
    )

    op.create_table(
        "template_change_logs",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "organization_id",
            sa.String(36),
            sa.ForeignKey("organizations.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "template_id",
            sa.String(36),
            sa.ForeignKey("equipment_check_templates.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "user_id",
            sa.String(36),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("user_name", sa.String(255), nullable=False),
        sa.Column("action", sa.String(30), nullable=False),
        sa.Column("entity_type", sa.String(30), nullable=False),
        sa.Column("entity_id", sa.String(36), nullable=True),
        sa.Column("entity_name", sa.String(200), nullable=True),
        sa.Column("changes", sa.JSON(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
        ),
    )

    op.create_index(
        "idx_tmpl_changelog_org",
        "template_change_logs",
        ["organization_id"],
    )
    op.create_index(
        "idx_tmpl_changelog_template",
        "template_change_logs",
        ["template_id"],
    )
    op.create_index(
        "idx_tmpl_changelog_created",
        "template_change_logs",
        ["created_at"],
    )


def downgrade() -> None:
    op.drop_table("template_change_logs")
    op.drop_column("shift_equipment_check_items", "critical_minimum_quantity")
    op.drop_column("check_template_items", "critical_minimum_quantity")
