"""Rejoin the three heads main forked into on 2026-11-04

``d75ecbc15bae`` (PR #4012, now continued here by ``d6906e3dd76c`` and
``67fac0bf1c09``), ``34f113ec86e3`` (by way of ``c0ae312b2385``) and
``4f1f4921a052`` each built on ``b5e906ebdd7d`` and reached ``main``
separately, leaving three heads. They touch unrelated tables (medical
screening grants and applicant names; historical admin-hours imports; the
interview-requested email), so this is a pure join.

Revision ID: 5ff3bac5f31d
Revises: 67fac0bf1c09, 34f113ec86e3, 4f1f4921a052
Create Date: 2026-11-04 12:57:00

"""

from typing import Sequence, Union

# revision identifiers, used by Alembic.
revision: str = "5ff3bac5f31d"
down_revision = ("67fac0bf1c09", "34f113ec86e3", "4f1f4921a052")
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """No-op: this revision exists only to rejoin three heads."""


def downgrade() -> None:
    """No-op: reversing a merge just restores the fork."""
