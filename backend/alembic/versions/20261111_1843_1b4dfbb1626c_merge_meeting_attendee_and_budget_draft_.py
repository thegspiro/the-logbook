"""merge meeting attendee and budget draft migration heads

Revision ID: 1b4dfbb1626c
Revises: 0136dd6d4144, 7b6db9dd8e4f
Create Date: 2026-11-11 18:43:00.000000

``0136dd6d4144`` (budget request drafts may be blank, #4246) and
``7b6db9dd8e4f`` (meeting attendee waiver link and unique member, #4247) both
revise ``09f0171ccf5e`` and merged to main within minutes of each other,
leaving two heads. They touch unrelated tables, so the order between them does
not matter.
"""

from typing import Sequence, Union

# revision identifiers, used by Alembic.
revision: str = "1b4dfbb1626c"
down_revision: Union[str, None] = ("0136dd6d4144", "7b6db9dd8e4f")
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """No-op: both parent revisions already performed their work."""


def downgrade() -> None:
    """No-op: reversing this merge restores the fork."""
