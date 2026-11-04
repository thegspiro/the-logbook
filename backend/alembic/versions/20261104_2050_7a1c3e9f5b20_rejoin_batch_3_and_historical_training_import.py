"""Rejoin batch 3's head and the historical training import

``67fac0bf1c09`` (#4024, applicant names) and ``514dca8e6de3`` (the
historical training import) each built on ``main`` separately, leaving two
heads. They touch unrelated tables, so this is a pure join.

Revision ID: 7a1c3e9f5b20
Revises: 67fac0bf1c09, 514dca8e6de3
Create Date: 2026-11-04 20:50:00

"""

from typing import Sequence, Union

# revision identifiers, used by Alembic.
revision: str = "7a1c3e9f5b20"
down_revision = ("67fac0bf1c09", "514dca8e6de3")
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """No-op: this revision exists only to rejoin two heads."""


def downgrade() -> None:
    """No-op: reversing a merge just restores the fork."""
