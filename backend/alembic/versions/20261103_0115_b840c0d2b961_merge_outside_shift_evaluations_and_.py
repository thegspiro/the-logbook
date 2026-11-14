"""merge outside-shift-evaluations and relink-transferred-prospect-screenings heads

Two branches extended the chain independently from `4c8e2f61a9d7` on
2026-11-02: `400ce5009f5e` (outside-agency shift evaluations) and
`beedcad5b36a` (re-linking a transferred prospect's screening records to
their member account). Neither touches the other's tables, but the chain
was left with two heads, which makes `alembic upgrade head` ambiguous.

This is a pure join: both parents already did their work, so there is
nothing to run here.

Revision ID: b840c0d2b961
Revises: 400ce5009f5e, beedcad5b36a
Create Date: 2026-11-03 01:15:37.445828

"""

from typing import Sequence, Union

# revision identifiers, used by Alembic.
revision: str = "b840c0d2b961"
down_revision: Union[str, None] = ("400ce5009f5e", "beedcad5b36a")
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """No-op: this revision exists only to rejoin two heads."""


def downgrade() -> None:
    """No-op: reversing a merge just restores the fork."""
