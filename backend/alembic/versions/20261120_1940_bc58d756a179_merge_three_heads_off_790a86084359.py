"""Merge the three heads that branched from 790a86084359

The guest-headcount-reminder template (73f64017f9e2), the training-attachment
string settlement (0c22a95b94b8) and the evaluation-step assignee
(a6c3e8d17f42) each revise 790a86084359 and merged to main separately, leaving
three heads and an ``alembic upgrade head`` that refuses to run. None touches
another's tables, so the merge carries no operations.

Revision ID: bc58d756a179
Revises: 73f64017f9e2, 0c22a95b94b8, a6c3e8d17f42
Create Date: 2026-11-20 19:40:44.205081

"""

from typing import Sequence, Union

# revision identifiers, used by Alembic.
revision: str = "bc58d756a179"
down_revision = ("73f64017f9e2", "0c22a95b94b8", "a6c3e8d17f42")
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
