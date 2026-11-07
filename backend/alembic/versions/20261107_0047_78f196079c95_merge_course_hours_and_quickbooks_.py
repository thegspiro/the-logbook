"""merge course hours and QuickBooks migration heads

Revision ID: 78f196079c95
Revises: de53b573ad3c, e4c6e82acbc2
Create Date: 2026-11-07 00:47:45.523550

"""

from typing import Sequence, Union

# revision identifiers, used by Alembic.
revision: str = "78f196079c95"
down_revision: Union[str, None] = ("de53b573ad3c", "e4c6e82acbc2")
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """No-op: both parent revisions already performed their work."""


def downgrade() -> None:
    """No-op: reversing this merge restores the fork."""
