"""add quantity_on_truck to check_template_items

A checklist item recorded how many an apparatus *should* carry
(required_quantity / expected_quantity) but never how many it actually has.
"Used two of the four" had nowhere to go: the restock flag could say something
was needed, not how short the truck was, so a supply officer could not tell a
box down to its last unit from one that had just been opened.

quantity_on_truck is that live count. NULL means nobody has counted since the
item was defined, and the expected figure stands in — reading NULL as zero
would report every untouched truck as stripped.

Revision ID: 20260810_0005
Revises: 20260810_0004
Create Date: 2026-08-10 14:00:00.000000

"""

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "20260810_0005"
down_revision = "20260810_0004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "check_template_items",
        sa.Column("quantity_on_truck", sa.Integer(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("check_template_items", "quantity_on_truck")
