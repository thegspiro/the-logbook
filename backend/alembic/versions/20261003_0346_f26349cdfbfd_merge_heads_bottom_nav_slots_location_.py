"""Merge the bottom-nav slots and location NFC badge check-in heads.

Revision ID: f26349cdfbfd
Revises: 8464e9962f76, 040ae44ad286
Create Date: 2026-10-03 03:46:46.290790

``8464e9962f76`` (``users.bottom_nav_slots``) and ``040ae44ad286``
(location NFC badge check-in, chained after ``5bed4c485d2f``) both branch
off ``f73b449bdb8b`` and were developed in parallel, leaving ``main`` with
two heads and ``alembic upgrade head`` ambiguous. This revision joins them
and has no schema effect of its own; the parents touch unrelated tables
(``users``; the location/NFC tables) and apply in either order.
"""

from typing import Sequence, Union

# revision identifiers, used by Alembic.
revision: str = "f26349cdfbfd"
down_revision: Union[str, None] = ("8464e9962f76", "040ae44ad286")
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """No-op: this revision exists only to rejoin two branches."""


def downgrade() -> None:
    """No-op: splitting the branches again requires no schema change."""
