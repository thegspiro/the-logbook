"""Add audit_logs.organization_id with backfill from user_id

Closes the deferred cross-cutting audit item: audit rows get a real
owning-tenant column so audit-history reads can be org-scoped directly
instead of joining through users or filtering event_data in Python.

- Nullable: platform-level events (pre-auth alerts, scheduled jobs) have
  no org. Plain string, no FK — audit rows are append-only and loosely
  coupled by design.
- Backfill: rows with a user_id inherit that user's current org. This
  touches only the new column — hash versions 1/2 do not include
  organization_id in the hash input, so every existing row still
  verifies. New rows are written with hash version 3, which does include
  it (tamper-proof org attribution going forward).

Revision ID: 20260801_0009
Revises: 20260801_0008
Create Date: 2026-08-01 00:09:00.000000
"""

import sqlalchemy as sa
from alembic import op

# revision identifiers
revision = "20260801_0009"
down_revision = "20260801_0008"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "audit_logs",
        sa.Column("organization_id", sa.String(36), nullable=True),
    )
    op.create_index(
        "idx_audit_organization_id",
        "audit_logs",
        ["organization_id"],
        unique=False,
    )
    op.execute(
        "UPDATE audit_logs a "
        "JOIN users u ON a.user_id = u.id "
        "SET a.organization_id = u.organization_id "
        "WHERE a.organization_id IS NULL"
    )


def downgrade() -> None:
    op.drop_index("idx_audit_organization_id", table_name="audit_logs")
    op.drop_column("audit_logs", "organization_id")
