"""Add fulfillment fields to equipment_requests

Adds columns that link an approved equipment request to the actual
issuance/checkout/assignment that satisfied it, so the request workflow
has a terminal "fulfilled" state instead of dead-ending at "approved".

Revision ID: 20260604_0100
Revises: 20260528_0002
Create Date: 2026-06-04 01:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "20260604_0100"
down_revision = "20260528_0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "equipment_requests",
        sa.Column(
            "fulfilled_by",
            sa.String(36),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.add_column(
        "equipment_requests",
        sa.Column("fulfilled_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "equipment_requests",
        sa.Column("fulfillment_type", sa.String(20), nullable=True),
    )
    op.add_column(
        "equipment_requests",
        sa.Column("fulfillment_reference_id", sa.String(36), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("equipment_requests", "fulfillment_reference_id")
    op.drop_column("equipment_requests", "fulfillment_type")
    op.drop_column("equipment_requests", "fulfilled_by")
    op.drop_column("equipment_requests", "fulfilled_at")
