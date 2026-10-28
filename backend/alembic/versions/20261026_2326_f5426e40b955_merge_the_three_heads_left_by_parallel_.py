"""merge the three heads left by parallel merges

Three revisions (sensitive form fields, pipeline applicant-email templates,
optional organization donor names) all forked from `1ad0b594f3fb` and each
landed on main within hours of the others, leaving three heads. With more
than one head, `alembic upgrade head` refuses to run.

This is a pure join: every parent already did its work, so there is
nothing to run here.

Revision ID: f5426e40b955
Revises: ce541de8d3da, 08e6220f2dce, e03f96c98452
Create Date: 2026-10-26 23:26:05.700599

"""

from typing import Sequence, Union

# revision identifiers, used by Alembic.
revision: str = "f5426e40b955"
down_revision: Union[str, None] = ("ce541de8d3da", "08e6220f2dce", "e03f96c98452")
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """No-op: this revision exists only to rejoin three heads."""


def downgrade() -> None:
    """No-op: reversing a merge just restores the fork."""
