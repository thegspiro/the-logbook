"""Add integration_type column to forms table

Revision ID: 20260303_0200
Revises: 20260303_0100
Create Date: 2026-03-03

Allows a form to declare its cross-module integration intent
(e.g. 'membership_interest') directly on the row.  When set,
submission processing uses label-based mapping inline instead
of requiring a separate FormIntegration record.
"""

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "20260303_0200"
down_revision = "20260303_0100"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "forms",
        sa.Column("integration_type", sa.String(50), nullable=True),
    )
    op.create_index(
        "idx_forms_integration_type",
        "forms",
        ["integration_type"],
    )


def downgrade() -> None:
    op.drop_index("idx_forms_integration_type", table_name="forms")
    op.drop_column("forms", "integration_type")
