"""merge crew recorded training and restricted funds folder heads

Two pull requests each merged ``3decd3ff6ce5`` and ``5b2e9c7d4a18``:
``cc91959dbaff`` (crew-recorded training submissions) took both as its
parents, and ``05ec84735fcf`` was a separate empty merge of the same pair.
That left two heads, so ``alembic upgrade head`` refused to run at all.

This revision first joined those two heads directly. ``70070d86ff27`` on
``main`` joined the same pair independently, so this one now follows it
instead. It is kept rather than deleted because databases were already
stamped with it, and a deleted revision makes their next upgrade fail with
"Can't locate revision". It does nothing.

Revision ID: 7a6684f8b975
Revises: 70070d86ff27
Create Date: 2026-10-13 20:44:51.610783

"""

from typing import Sequence, Union

# revision identifiers, used by Alembic.
revision: str = "7a6684f8b975"
down_revision: Union[str, None] = "70070d86ff27"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
