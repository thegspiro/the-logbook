"""merge history media and election/minutes email template heads

Two pull requests branched from ``7735ee22aa76`` and merged on 2026-11-14,
each tested against a main that did not yet have the other:

* History phase 3 (photos and media) added ``7a3c9e1d5b42``.
* #4295 (election and minutes emails as editable templates) added
  ``c4e81b7a2d95``.

Main was left with two heads, so ``alembic upgrade head`` refuses to run and
the startup fallback in ``main.py`` upgrades to only one of them. This
revision joins the two heads. An installation stamped at either parent
applies the other on its next upgrade.

Nothing is created here. Each parent already does its own work.

Revision ID: e2b7d94c1a63
Revises: 7a3c9e1d5b42, c4e81b7a2d95
Create Date: 2026-11-14 18:30:00.000000

"""

from typing import Sequence, Union

# revision identifiers, used by Alembic.
revision: str = "e2b7d94c1a63"
down_revision: Union[str, None] = ("7a3c9e1d5b42", "c4e81b7a2d95")
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """No-op: both parent revisions already performed their work."""


def downgrade() -> None:
    """No-op: reversing this merge restores the fork."""
