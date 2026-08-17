"""restore active prospect email uniqueness

Revision ID: 20260812_0003
Revises: 20260812_0002
Create Date: 2026-08-12 00:00:00.000000
"""

import sqlalchemy as sa
from alembic import op

revision = "20260812_0003"
down_revision = "20260812_0002"
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
        # The unique index already guards the table, so the data is already
        # consistent with it — nothing to reconcile, nothing to create.
        return

    # Reconcile legacy duplicates BEFORE creating the unique index. This is a
    # deliberate copy of the repair in 20260814_0003_reconcile_active_prospect
    # _emails.py: that revision is chained AFTER this one, so an install
    # upgrading from 20260812_0002 with duplicate active emails would fail
    # right here — inside op.create_index — and never reach the cleanup.
    # Installs already stamped past this revision never re-run it, so the
    # duplication is harmless for them; it only makes fresh upgrade paths
    # robust. Keep the two copies textually identical (a test enforces this).
    op.execute(
        sa.text(
            "UPDATE prospective_members SET email = LOWER(TRIM(email)) "
            "WHERE email IS NOT NULL"
        )
    )
    # COALESCE makes the created_at tie-break null-safe: rows with a NULL
    # created_at sort as oldest, and the id comparison breaks exact ties so
    # exactly one active row per (organization_id, email) survives.
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
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "prospective_members" not in inspector.get_table_names():
        return

    indexes = {index["name"] for index in inspector.get_indexes("prospective_members")}
    if _INDEX in indexes:
        op.drop_index(_INDEX, table_name="prospective_members")

    columns = {
        column["name"] for column in inspector.get_columns("prospective_members")
    }
    if "active_email" in columns:
        op.drop_column("prospective_members", "active_email")
