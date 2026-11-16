"""join the shift-evaluation-requirements and evaluated-calls heads

``611204dcf8d1`` (#4312, ``shifts.evaluation_requirements``) and
``9d044fc1d81b`` (#4314, the ``evaluated_calls`` requirement type) both
revise ``d3a7f5e2c916`` and merged within a minute of each other, so main
has two heads and ``alembic upgrade head`` refuses to run. They touch
different tables, so this is a pure join.

Nothing is created here.

Revision ID: 1d7fde550351
Revises: 611204dcf8d1, 9d044fc1d81b
Create Date: 2026-11-15 18:45:00.000000

"""

from typing import Sequence, Union

# revision identifiers, used by Alembic.
revision: str = "1d7fde550351"
# One line: scripts/validate_migrations.py reads down_revision line by line.
down_revision = ("611204dcf8d1", "9d044fc1d81b")
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """No-op: each parent revision already performed its work."""


def downgrade() -> None:
    """No-op: reversing this merge restores the two heads."""
