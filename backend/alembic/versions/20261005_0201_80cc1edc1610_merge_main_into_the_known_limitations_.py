"""merge main into the known-limitations branch

Joins main's head with this branch's migrations (organization locks, the
refresh-grace column drop, session reaping, password expiry notice, the
inventory clamp). The two lines touch different tables, so the merge itself
changes nothing.

Revision ID: 80cc1edc1610
Revises: 34d3d56d1479, 7d2e4f6a8b13
Create Date: 2026-10-05 02:01:27.426934

"""

from typing import Sequence, Union

# revision identifiers, used by Alembic.
revision: str = "80cc1edc1610"
down_revision: Union[str, None] = ("34d3d56d1479", "7d2e4f6a8b13")
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
