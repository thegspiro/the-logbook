"""Merge the evaluation-step-assignee, training-attachment and guest-headcount heads

``a6c3e8d17f42`` (evaluation step assignee), ``0c22a95b94b8`` (settle training
attachment strings) and ``73f64017f9e2`` (guest headcount reminder email
template) each revise ``790a86084359``. Each pull request saw a single head in
its own CI run, and all three landed on ``main`` on 2026-11-20, so
``alembic upgrade head`` refuses to run until they are rejoined.

Nothing is created here. Each revision already ran its own DDL, and Alembic
runs each revision exactly once however many merge paths reach it.

Revision ID: 5b8e1f4c2a73
Revises: a6c3e8d17f42, 0c22a95b94b8, 73f64017f9e2
Create Date: 2026-11-20 19:50:00.000000
"""

from typing import Sequence, Union

# revision identifiers, used by Alembic.
revision: str = "5b8e1f4c2a73"
# Keep the tuple on one line: the repository's lightweight migration-chain
# validators parse revision metadata one physical line at a time.
# fmt: off
down_revision: Union[str, Sequence[str], None] = ("a6c3e8d17f42", "0c22a95b94b8", "73f64017f9e2")
# fmt: on
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """No-op: a merge revision only reconciles the revision graph."""


def downgrade() -> None:
    """No-op: splitting the graph back into three heads needs no DDL."""
