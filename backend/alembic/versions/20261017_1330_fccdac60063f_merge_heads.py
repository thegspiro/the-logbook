"""Merge the ballot-send-job-kind and directory-account-license heads

Two pull requests both merged into main within minutes of each other on
2026-10-17: ``244b0fd07205`` (ballot send jobs: record whether a job sends
ballots or a reminder, revising ``c87efd81c5aa``) and ``d3bb8f81ed07``
(directory account license and on-premises flags, revising
``73594b326e68``). Neither branch's own ancestry saw the other, so the
revision graph was left with two heads and ``alembic upgrade head`` fails
until they are rejoined.

Nothing is created here. Both tables/columns already come from their own
side, and Alembic runs each revision exactly once no matter how many merge
paths reach it.

Revision ID: fccdac60063f
Revises: 244b0fd07205, d3bb8f81ed07
Create Date: 2026-10-17 13:30:06.669353
"""

from typing import Sequence, Union

# revision identifiers, used by Alembic.
revision: str = "fccdac60063f"
down_revision: Union[str, Sequence[str], None] = ("244b0fd07205", "d3bb8f81ed07")
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """No-op: a merge revision only reconciles the revision graph."""


def downgrade() -> None:
    """No-op: splitting the graph back into two heads needs no DDL."""
