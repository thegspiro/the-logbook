"""add event reminder target

Revision ID: 20260813_0020
Revises: 20260813_0010
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "20260813_0020"
down_revision: Union[str, None] = "20260813_0010"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "events",
        sa.Column(
            "reminder_target",
            sa.String(length=20),
            nullable=False,
            server_default="going",
        ),
    )
    # Preserve the behavior that existed before reminder audiences were
    # configurable: mandatory events reminded every active member, while
    # optional events reminded members who had signed up.
    op.execute(
        sa.text("UPDATE events SET reminder_target = 'all' WHERE is_mandatory = 1")
    )


def downgrade() -> None:
    op.drop_column("events", "reminder_target")
