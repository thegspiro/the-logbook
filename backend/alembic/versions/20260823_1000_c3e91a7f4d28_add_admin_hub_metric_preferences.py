"""Add admin hub metric preferences.

Revision ID: c3e91a7f4d28
Revises: a17c4e9d2b61

Stores which three headline metrics an administration page shows, either
department-wide (``scope_key = '__department__'``) or for one admin
(``scope_key = user_id``). No backfill: an organization with no row keeps the
module's built-in default four, which is what every organization sees today.
"""

import sqlalchemy as sa
from alembic import op

revision = "c3e91a7f4d28"
down_revision = "a17c4e9d2b61"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "admin_hub_metric_preferences",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column(
            "organization_id",
            sa.String(length=36),
            sa.ForeignKey("organizations.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("module_key", sa.String(length=50), nullable=False),
        sa.Column(
            "user_id",
            sa.String(length=36),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=True,
            comment="NULL on the department-wide row; set on a personal override.",
        ),
        sa.Column(
            "scope_key",
            sa.String(length=36),
            nullable=False,
            server_default="__department__",
            comment="user_id, or '__department__' for the department-wide row.",
        ),
        sa.Column("metric_keys", sa.JSON(), nullable=False),
        sa.Column(
            "applies_to_everyone",
            sa.Boolean(),
            nullable=False,
            server_default="1",
        ),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now()
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()
        ),
    )
    op.create_unique_constraint(
        "uq_admin_hub_metric_pref_scope",
        "admin_hub_metric_preferences",
        ["organization_id", "module_key", "scope_key"],
    )
    op.create_index(
        "idx_admin_hub_metric_pref_org_module",
        "admin_hub_metric_preferences",
        ["organization_id", "module_key"],
    )


def downgrade() -> None:
    op.drop_index(
        "idx_admin_hub_metric_pref_org_module",
        table_name="admin_hub_metric_preferences",
    )
    op.drop_constraint(
        "uq_admin_hub_metric_pref_scope",
        "admin_hub_metric_preferences",
        type_="unique",
    )
    op.drop_table("admin_hub_metric_preferences")
