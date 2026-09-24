"""default user_consents.granted to false

`granted` was NOT NULL with no default. A consent row that reached the table
without an explicit value would fail the insert rather than record anything —
and the only safe value to record in that case is "not granted": a member
who was never asked counts as having refused (see app/models/consent.py), and
SMS consent is a TCPA requirement, so a default grant is never acceptable.

This only adds a column default. Every existing row already holds an explicit
value, and the one writer (ConsentService) always sets it, so no stored
consent changes and no current insert behaves differently.

Revision ID: b4014469fd76
Revises: 7d2b4e8a1c35
Create Date: 2026-09-24 20:38:11.683997

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "b4014469fd76"
down_revision: Union[str, None] = "7d2b4e8a1c35"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.alter_column(
        "user_consents",
        "granted",
        existing_type=sa.Boolean(),
        existing_nullable=False,
        server_default=sa.false(),
    )


def downgrade() -> None:
    op.alter_column(
        "user_consents",
        "granted",
        existing_type=sa.Boolean(),
        existing_nullable=False,
        server_default=None,
    )
