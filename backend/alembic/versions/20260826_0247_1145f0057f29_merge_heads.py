"""merge heads

Revision ID: 1145f0057f29
Revises: a1f7c34e9b02, c4f8a2e70d19, c6a3f8b41e29
Create Date: 2026-08-26 02:47:54.065220

"""

from typing import Sequence, Union

# revision identifiers, used by Alembic.
revision: str = "1145f0057f29"
down_revision: Union[str, None] = ("a1f7c34e9b02", "c4f8a2e70d19", "c6a3f8b41e29")
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
