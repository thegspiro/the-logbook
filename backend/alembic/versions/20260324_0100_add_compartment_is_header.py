"""Add is_header column to check_template_compartments

Allows compartments to act as visual section dividers in the checklist
overview, grouping related compartments under a heading without being
clickable or containing check items.

Revision ID: 20260324_0100
Revises: a9f3e7c10004, 20260323_0100
Create Date: 2026-03-24
"""

from alembic import op
import sqlalchemy as sa


# revision identifiers
revision = "20260324_0100"
down_revision = ("a9f3e7c10004", "20260323_0100")
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "check_template_compartments",
        sa.Column(
            "is_header",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("0"),
        ),
    )


def downgrade() -> None:
    op.drop_column("check_template_compartments", "is_header")
