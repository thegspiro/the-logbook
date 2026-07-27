"""Add hash_version to audit_logs for keyed (HMAC) hash chain

The audit hash chain moves from unkeyed SHA-256 (tamper-evident only) to keyed
HMAC-SHA256 (tamper-proof without the signing key). hash_version records which
algorithm produced each row so pre-upgrade entries keep verifying under SHA-256
while all new entries use HMAC. Existing rows stay NULL (treated as version 1).

Revision ID: 20260726_0001
Revises: 20260725_0001
Create Date: 2026-07-21 00:00:00.000000

"""

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "20260726_0001"
down_revision = "20260725_0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "audit_logs",
        sa.Column("hash_version", sa.Integer(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("audit_logs", "hash_version")
