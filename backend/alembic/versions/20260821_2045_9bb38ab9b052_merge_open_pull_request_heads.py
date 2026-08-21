"""merge open pull request heads

Revision ID: 9bb38ab9b052
Revises: 06adc68a8b84, 5223a69474b8, 5c2f6a8b1d34, d6f4a13c9e20, 8a4f2d1c9b30
Create Date: 2026-08-21 20:45:02.175867

"""

from typing import Sequence, Union

# revision identifiers, used by Alembic.
revision: str = "9bb38ab9b052"
# Keep the tuple on one line: the repository's lightweight migration-chain
# validators intentionally parse revision metadata one physical line at a time.
# fmt: off
down_revision: Union[str, None] = ("06adc68a8b84", "5223a69474b8", "5c2f6a8b1d34", "d6f4a13c9e20", "8a4f2d1c9b30")
# fmt: on
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
