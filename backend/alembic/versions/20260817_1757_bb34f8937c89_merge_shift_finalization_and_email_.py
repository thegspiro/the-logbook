"""merge shift finalization and email preference heads

Two branches extended `20260816_0005` on the same day and both landed:
`20260816_0006` (backfill legacy shift finalization) and `20260816_0007`
(unify the duplicate email notification preference). Neither is wrong on its
own — the files do not overlap, so git merged them silently — but the chain
was left with two heads, which makes `alembic upgrade head` ambiguous and
fails the single-head guards in `tests/test_alembic_migrations.py` and
`tests/test_changelog_fixes.py`.

This is a pure join: both parents already did their work, so there is nothing
to run here. Empty upgrade/downgrade is the point.

Revision ID: bb34f8937c89
Revises: 20260816_0006, 20260816_0007
Create Date: 2026-08-17 17:57:31.774463

"""

from typing import Sequence, Union

# revision identifiers, used by Alembic.
revision: str = "bb34f8937c89"
down_revision: Union[str, None] = ("20260816_0006", "20260816_0007")
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """No-op: this revision exists only to rejoin two heads."""


def downgrade() -> None:
    """No-op: reversing a merge just restores the fork."""
