"""merge restricted funds and folder positions by id heads

Revision ID: 05ec84735fcf
Revises: 3decd3ff6ce5, 5b2e9c7d4a18
Create Date: 2026-10-13 15:48:27.351917

"""

from typing import Sequence, Union

# revision identifiers, used by Alembic.
revision: str = "05ec84735fcf"
down_revision: Union[str, None] = ("3decd3ff6ce5", "5b2e9c7d4a18")
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
