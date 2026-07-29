"""Add paper-ballot batch + attestation tables

Paper-tally batches become first-class rows so an organization can require
N officers (default 2) to attest a recorded batch before its votes count
in results. The batch snapshot of required_attestations means changing the
org setting later never silently confirms or un-confirms an old batch.

Revision ID: 20260801_0007
Revises: 20260801_0006
Create Date: 2026-08-01 00:07:00.000000
"""

import sqlalchemy as sa

from alembic import op

# revision identifiers
revision = "20260801_0007"
down_revision = "20260801_0006"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "manual_ballot_batches",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "election_id",
            sa.String(36),
            sa.ForeignKey("elections.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "organization_id",
            sa.String(36),
            sa.ForeignKey("organizations.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "recorded_by",
            sa.String(36),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("status", sa.String(20), nullable=False, server_default="pending"),
        sa.Column(
            "required_attestations",
            sa.Integer(),
            nullable=False,
            server_default="0",
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
        sa.Column("confirmed_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index(
        "ix_manual_ballot_batches_election_id",
        "manual_ballot_batches",
        ["election_id"],
        unique=False,
    )
    op.create_index(
        "ix_manual_ballot_batches_organization_id",
        "manual_ballot_batches",
        ["organization_id"],
        unique=False,
    )

    op.create_table(
        "manual_ballot_attestations",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "batch_id",
            sa.String(36),
            sa.ForeignKey("manual_ballot_batches.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "organization_id",
            sa.String(36),
            sa.ForeignKey("organizations.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "attested_by",
            sa.String(36),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "attested_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
        sa.UniqueConstraint("batch_id", "attested_by", name="uq_batch_attester"),
    )
    op.create_index(
        "ix_manual_ballot_attestations_batch_id",
        "manual_ballot_attestations",
        ["batch_id"],
        unique=False,
    )
    op.create_index(
        "ix_manual_ballot_attestations_organization_id",
        "manual_ballot_attestations",
        ["organization_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        "ix_manual_ballot_attestations_organization_id",
        table_name="manual_ballot_attestations",
    )
    op.drop_index(
        "ix_manual_ballot_attestations_batch_id",
        table_name="manual_ballot_attestations",
    )
    op.drop_table("manual_ballot_attestations")
    op.drop_index(
        "ix_manual_ballot_batches_organization_id",
        table_name="manual_ballot_batches",
    )
    op.drop_index(
        "ix_manual_ballot_batches_election_id", table_name="manual_ballot_batches"
    )
    op.drop_table("manual_ballot_batches")
