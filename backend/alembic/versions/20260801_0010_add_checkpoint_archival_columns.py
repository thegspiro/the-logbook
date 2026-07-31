"""Add retention-archival columns to audit_log_checkpoints

Enforcing HIPAA_AUDIT_RETENTION_DAYS means eventually deleting the oldest
rows of the audit hash chain — which the integrity verifier is specifically
designed to flag ("Chain head missing"). These columns let the retention job
sanction that deletion cryptographically:

- last_log_hash: chain hash of the final purged row; the surviving chain
  head's previous_hash must equal it.
- archive_attestation: keyed HMAC over the archived range. A DB-only
  attacker can delete rows and set archived_at, but cannot mint a valid
  attestation without the audit signing key, so unsanctioned head deletion
  still fails verification.
- archived_at: when the export-and-purge ran.

Revision ID: 20260801_0010
Revises: 20260801_0009
Create Date: 2026-08-01 00:10:00.000000
"""

import sqlalchemy as sa

from alembic import op

# revision identifiers
revision = "20260801_0010"
down_revision = "20260801_0009"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "audit_log_checkpoints",
        sa.Column("archived_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "audit_log_checkpoints",
        sa.Column("last_log_hash", sa.String(64), nullable=True),
    )
    op.add_column(
        "audit_log_checkpoints",
        sa.Column("archive_attestation", sa.String(64), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("audit_log_checkpoints", "archive_attestation")
    op.drop_column("audit_log_checkpoints", "last_log_hash")
    op.drop_column("audit_log_checkpoints", "archived_at")
