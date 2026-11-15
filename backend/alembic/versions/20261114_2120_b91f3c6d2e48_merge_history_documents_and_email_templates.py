"""merge history documents and election/minutes email template heads

Two pull requests branched from main and merged on 2026-11-14, each tested
against a main that did not yet have the other:

* History phase 3 and 4 (photos and media, then documents) added
  ``7a3c9e1d5b42`` and ``4d8e2b6f1c93`` on top of it.
* #4295 (election and minutes emails as editable templates) added
  ``c4e81b7a2d95``.

Main was left with two heads, so ``alembic upgrade head`` refuses to run and
the Migration Chain CI job fails on every pull request. This revision joins
the two heads. An installation stamped at either parent applies the other on
its next upgrade.

Nothing is created here. Each parent already does its own work.

Revision ID: b91f3c6d2e48
Revises: 4d8e2b6f1c93, c4e81b7a2d95
Create Date: 2026-11-14 21:20:00.000000

"""

from typing import Sequence, Union

# revision identifiers, used by Alembic.
revision: str = "b91f3c6d2e48"
down_revision: Union[str, None] = ("4d8e2b6f1c93", "c4e81b7a2d95")
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """No-op: both parent revisions already performed their work."""


def downgrade() -> None:
    """No-op: reversing this merge restores the fork."""
