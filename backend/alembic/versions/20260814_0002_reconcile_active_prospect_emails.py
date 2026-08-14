"""Reconcile active prospect emails without rewriting released history.

Revision ID: 20260814_0002
Revises: 20260814_0001
"""

import sqlalchemy as sa
from alembic import op

revision = "20260814_0002"
down_revision = "20260814_0001"
branch_labels = None
depends_on = None

_INDEX = "uq_prospect_org_active_email"


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "prospective_members" not in inspector.get_table_names():
        return

    indexes = {index["name"] for index in inspector.get_indexes("prospective_members")}
    if _INDEX in indexes:
        op.drop_index(_INDEX, table_name="prospective_members")

    op.execute(
        sa.text(
            "UPDATE prospective_members SET email = LOWER(TRIM(email)) "
            "WHERE email IS NOT NULL"
        )
    )
    op.execute(
        sa.text(
            "UPDATE prospective_members AS duplicate "
            "JOIN prospective_members AS keeper "
            "  ON keeper.organization_id = duplicate.organization_id "
            " AND keeper.status = 'active' "
            " AND duplicate.status = 'active' "
            " AND keeper.email = duplicate.email "
            " AND (COALESCE(keeper.created_at, '1000-01-01') "
            "      < COALESCE(duplicate.created_at, '1000-01-01') "
            "      OR (COALESCE(keeper.created_at, '1000-01-01') "
            "          = COALESCE(duplicate.created_at, '1000-01-01') "
            "          AND keeper.id < duplicate.id)) "
            "SET duplicate.status = 'inactive'"
        )
    )

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
    op.create_index(
        _INDEX,
        "prospective_members",
        ["organization_id", "active_email"],
        unique=True,
    )


def downgrade() -> None:
    # Canonicalization and duplicate reconciliation are data repairs and cannot
    # be reversed. Keep the uniqueness guard installed on downgrade.
    pass
