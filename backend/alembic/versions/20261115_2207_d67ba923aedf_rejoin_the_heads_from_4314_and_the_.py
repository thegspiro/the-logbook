"""Rejoin the two heads main forked into when #4312 and #4314 merged

Both pull requests chained their migration after ``d3a7f5e2c916`` and merged
separately, leaving ``main`` with two heads, so ``alembic upgrade head``
refuses to run (the backend migrates itself on startup):

- ``611204dcf8d1`` (#4312): freeze a shift's evaluation requirements, a JSON
  column on ``shifts``;
- ``9d044fc1d81b`` (#4314): the evaluated-calls requirement type, a value
  added to the training requirements' ``requirement_type`` enum.

They touch unrelated tables, so this is a pure join with no schema effect.

Revision ID: d67ba923aedf
Revises: 9d044fc1d81b, 611204dcf8d1
Create Date: 2026-11-15 22:07:44.485005
"""

from typing import Sequence, Union

# revision identifiers, used by Alembic.
revision: str = "d67ba923aedf"
down_revision: Union[str, Sequence[str], None] = ("9d044fc1d81b", "611204dcf8d1")
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """No-op: this revision exists only to rejoin two branches."""


def downgrade() -> None:
    """No-op: splitting the branches again requires no schema change."""
