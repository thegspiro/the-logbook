"""Add requirement_progress_credits idempotency ledger

Records one row per automated progress accrual, keyed uniquely by
(progress_id, source_type, source_id). The unique constraint is the safeguard
that stops a single real training from being credited twice across the pipeline
feeds (session approval, shift completion, external import, officer apply) — a
retry or re-sync of the same source record is rejected at the DB level. The
recorded ``units`` also let an officer cleanly reverse one credit later.

Revision ID: 20260719_0001
Revises: 20260718_0001
Create Date: 2026-07-16 00:00:00.000000

"""

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "20260719_0001"
down_revision = "20260718_0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "requirement_progress_credits",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("progress_id", sa.String(length=36), nullable=False),
        sa.Column(
            "source_type",
            sa.Enum(
                "training_session",
                "shift_report",
                "external_import",
                "officer_apply",
                name="progresscreditsource",
            ),
            nullable=False,
        ),
        sa.Column("source_id", sa.String(length=64), nullable=False),
        sa.Column("units", sa.Float(), nullable=False, server_default="0"),
        sa.Column("applied_by", sa.String(length=36), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=True,
        ),
        sa.ForeignKeyConstraint(
            ["progress_id"],
            ["requirement_progress.id"],
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["applied_by"],
            ["users.id"],
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "progress_id",
            "source_type",
            "source_id",
            name="uq_progress_credit_source",
        ),
    )
    op.create_index(
        "idx_progress_credit_progress",
        "requirement_progress_credits",
        ["progress_id"],
    )


def downgrade() -> None:
    op.drop_index(
        "idx_progress_credit_progress",
        table_name="requirement_progress_credits",
    )
    op.drop_table("requirement_progress_credits")
