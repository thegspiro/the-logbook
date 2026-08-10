"""add expiration_found to shift_equipment_check_items

A checklist item's expiration lives on the template row
(check_template_items.expiration_date), and a crew that replaces a unit in the
field could already write back the new serial and lot number — but not the new
expiration. The old date therefore survived the replacement, and because an
expired item is force-failed on every submission, the item failed forever, held
the apparatus in a deficiency state, and never left the supply worklist.

expiration_found is the missing counterpart to serial_found / lot_found: what
the crew read off the replacement unit. It is written back onto the template
item on submit, exactly as the lot number already is.

Revision ID: 20260810_0003
Revises: 20260810_0002
Create Date: 2026-08-10 12:00:00.000000

"""

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "20260810_0003"
down_revision = "20260810_0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "shift_equipment_check_items",
        sa.Column("expiration_found", sa.Date(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("shift_equipment_check_items", "expiration_found")
