"""Add organization_id to security_alerts for tenant isolation

Security alerts were stored in a single global table with no owning tenant, so
any org admin could read — and acknowledge/resolve (suppress) — every other
org's security alerts. This adds `organization_id` (nullable) so alerts can be
scoped to a tenant, and backfills it from each alert's `user_id` -> the user's
organization. Alerts with no `user_id` (pre-auth / IP-only, e.g. brute force
against the login page) stay NULL: they are platform-level, not owned by any org.

Revision ID: 20260728_0001
Revises: 20260727_0001
Create Date: 2026-07-26 00:00:00.000000

"""

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "20260728_0001"
down_revision = "20260727_0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "security_alerts",
        sa.Column("organization_id", sa.String(length=36), nullable=True),
    )
    op.create_index(
        "ix_security_alerts_organization_id",
        "security_alerts",
        ["organization_id"],
    )
    op.create_index(
        "idx_security_alert_org_timestamp",
        "security_alerts",
        ["organization_id", "timestamp"],
    )

    # Backfill existing rows: attribute each alert to the organization of its
    # user_id. Rows with no user_id (or a since-deleted user) remain NULL and are
    # treated as platform-level. Parameterized join-update, safe on MySQL.
    op.execute(
        sa.text(
            "UPDATE security_alerts sa "
            "JOIN users u ON u.id = sa.user_id "
            "SET sa.organization_id = u.organization_id "
            "WHERE sa.user_id IS NOT NULL AND sa.organization_id IS NULL"
        )
    )


def downgrade() -> None:
    op.drop_index(
        "idx_security_alert_org_timestamp", table_name="security_alerts"
    )
    op.drop_index(
        "ix_security_alerts_organization_id", table_name="security_alerts"
    )
    op.drop_column("security_alerts", "organization_id")
