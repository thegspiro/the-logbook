"""Add physical receipt evidence and return-request stages.

Revision ID: f4a9c2d81e70
Revises: 472a1e34aa84
Create Date: 2026-08-26 15:00:00
"""

from alembic import op
import sqlalchemy as sa

revision = "f4a9c2d81e70"
down_revision = "472a1e34aa84"
branch_labels = None
depends_on = None


def upgrade():
    bind = op.get_bind()
    dialect = bind.dialect.name
    if dialect == "postgresql":
        for value in ("requested", "received", "inspected"):
            op.execute(
                sa.text(
                    f"ALTER TYPE returnrequeststatus ADD VALUE IF NOT EXISTS '{value}'"
                )
            )
    elif dialect in {"mysql", "mariadb"}:
        op.execute(
            "ALTER TABLE return_requests MODIFY status ENUM('pending','approved','requested','received','inspected','denied','completed') NOT NULL DEFAULT 'requested'"
        )
    op.execute(
        sa.text("UPDATE return_requests SET status='requested' WHERE status='pending'")
    )
    op.execute(
        sa.text("UPDATE return_requests SET status='received' WHERE status='approved'")
    )
    with op.batch_alter_table("return_requests") as batch:
        batch.add_column(
            sa.Column(
                "observed_condition",
                sa.Enum(
                    "excellent",
                    "good",
                    "fair",
                    "poor",
                    "damaged",
                    "out_of_service",
                    "retired",
                    name="itemcondition",
                ),
                nullable=True,
            )
        )
        batch.add_column(
            sa.Column("verified_identifier", sa.String(255), nullable=True)
        )
        batch.add_column(sa.Column("received_quantity", sa.Integer(), nullable=True))
        batch.add_column(sa.Column("follow_up_type", sa.String(32), nullable=True))
        batch.add_column(sa.Column("follow_up_id", sa.String(36), nullable=True))


def downgrade():
    op.execute(
        sa.text(
            "UPDATE return_requests SET status='pending' WHERE status IN ('requested','received','inspected')"
        )
    )
    with op.batch_alter_table("return_requests") as batch:
        for name in (
            "follow_up_id",
            "follow_up_type",
            "received_quantity",
            "verified_identifier",
            "observed_condition",
        ):
            batch.drop_column(name)
