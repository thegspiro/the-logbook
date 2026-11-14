"""merge budget drafts and meeting waiver link heads

Two pull requests branched from ``09f0171ccf5e`` and merged on 2026-11-11
within minutes of each other, each tested against a main that did not yet
have the other:

* #4250 (budget request drafts may be blank) added ``0136dd6d4144``.
* #4247 (business-meeting waiver workflow) added ``7b6db9dd8e4f``.

Main was left with two heads. ``alembic upgrade head`` then refuses to run,
and the startup fallback in ``main.py`` takes ``sorted(heads)[-1]`` and
upgrades to ``7b6db9dd8e4f`` alone, so an installation started on that main
never applied ``0136dd6d4144``. This revision joins the two heads. An
installation stamped at either parent applies the other on its next upgrade:
Alembic runs each revision once, whichever merge path reaches it.

Nothing is created here. Each parent already does its own work.

Revision ID: ccd374a66f82
Revises: 0136dd6d4144, 7b6db9dd8e4f
Create Date: 2026-11-11 18:45:30.633495

"""

from typing import Sequence, Union

# revision identifiers, used by Alembic.
revision: str = "ccd374a66f82"
down_revision: Union[str, None] = ("0136dd6d4144", "7b6db9dd8e4f")
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """No-op: both parent revisions already performed their work."""


def downgrade() -> None:
    """No-op: reversing this merge restores the fork."""
