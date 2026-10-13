"""merge crew recorded training and restricted funds folder heads

Two pull requests each merged ``3decd3ff6ce5`` and ``5b2e9c7d4a18``:
``cc91959dbaff`` (crew-recorded training submissions) took both as its
parents, and ``05ec84735fcf`` was a separate empty merge of the same pair.
That left two heads, so ``alembic upgrade head`` refused to run at all.
Both are published, so they are joined here rather than edited.

Revision ID: 7a6684f8b975
Revises: cc91959dbaff, 05ec84735fcf
Create Date: 2026-10-13 20:44:51.610783

"""

from typing import Sequence, Union

# revision identifiers, used by Alembic.
revision: str = "7a6684f8b975"
down_revision: Union[str, None] = ("cc91959dbaff", "05ec84735fcf")
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
