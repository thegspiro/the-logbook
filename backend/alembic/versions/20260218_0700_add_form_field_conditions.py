"""Add conditional visibility columns to form_fields

Revision ID: 20260218_0700
Revises: 20260218_0600
Create Date: 2026-02-18 07:00:00.000000
"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "20260218_0700"
down_revision = "20260218_0600"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("form_fields", sa.Column("condition_field_id", sa.String(36), nullable=True))
    op.add_column("form_fields", sa.Column("condition_operator", sa.String(20), nullable=True))
    op.add_column("form_fields", sa.Column("condition_value", sa.String(500), nullable=True))


def downgrade() -> None:
    op.drop_column("form_fields", "condition_value")
    op.drop_column("form_fields", "condition_operator")
    op.drop_column("form_fields", "condition_field_id")
