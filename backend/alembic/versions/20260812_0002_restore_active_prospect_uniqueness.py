"""restore active prospect email uniqueness

Revision ID: 20260812_0002
Revises: 20260812_0001
Create Date: 2026-08-12 00:00:00.000000
"""

import sqlalchemy as sa
from alembic import op

revision = "20260812_0002"
down_revision = "20260812_0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "prospective_members" not in inspector.get_table_names():
        return

    columns = {
        column["name"] for column in inspector.get_columns("prospective_members")
    }
    if "active_email" not in columns:
        op.execute(
            "ALTER TABLE prospective_members "
            "ADD COLUMN active_email VARCHAR(255) GENERATED ALWAYS AS ("
            "  CASE WHEN status = 'active' THEN email ELSE NULL END"
            ") STORED"
        )

    indexes = {index["name"] for index in inspector.get_indexes("prospective_members")}
    if "uq_prospect_org_active_email" not in indexes:
        op.create_index(
            "uq_prospect_org_active_email",
            "prospective_members",
            ["organization_id", "active_email"],
            unique=True,
        )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "prospective_members" not in inspector.get_table_names():
        return

    indexes = {index["name"] for index in inspector.get_indexes("prospective_members")}
    if "uq_prospect_org_active_email" in indexes:
        op.drop_index("uq_prospect_org_active_email", table_name="prospective_members")

    columns = {
        column["name"] for column in inspector.get_columns("prospective_members")
    }
    if "active_email" in columns:
        op.drop_column("prospective_members", "active_email")
