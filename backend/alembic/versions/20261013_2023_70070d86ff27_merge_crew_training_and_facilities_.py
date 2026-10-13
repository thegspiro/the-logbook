"""merge crew training and facilities merge heads

PR 3094 (crew-recorded training) joined 3decd3ff6ce5 and 5b2e9c7d4a18 itself,
and PR 3169/3175 each added 05ec84735fcf to join the same two, which left
main with two heads. ``alembic upgrade head`` refuses to run with two, so the
crew migration's new training_submissions columns never reached a database
upgraded from main, and every query selecting TrainingSubmission (the
My Training page among them) failed with "Unknown column".

Revision ID: 70070d86ff27
Revises: cc91959dbaff, 05ec84735fcf
Create Date: 2026-10-13 20:23:24.871756

"""

from typing import Sequence, Union

# revision identifiers, used by Alembic.
revision: str = "70070d86ff27"
down_revision: Union[str, None] = ("cc91959dbaff", "05ec84735fcf")
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
