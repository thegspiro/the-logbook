"""merge historical-import-admin-hours, interview-requested-email, and
drop-unused-compliance-and-folder heads

Three branches extended the chain independently on 2026-11-03/04:
`d75ecbc15bae` (dropping unused compliance/folder tables), `34f113ec86e3`
(the admin-hours historical import), and `4f1f4921a052` (the
interview-requested email). None of the three touches a table either of the
others does, but the chain was left with three heads, which makes `alembic
upgrade head` ambiguous.

This is a pure join: all three parents already did their work, so there is
nothing to run here.

Revision ID: e0515bbe57ef
Revises: 34f113ec86e3, 4f1f4921a052, d75ecbc15bae
Create Date: 2026-11-04 16:49:19.970019

"""

from typing import Sequence, Union

# revision identifiers, used by Alembic.
revision: str = "e0515bbe57ef"
down_revision: Union[str, None] = ("34f113ec86e3", "4f1f4921a052", "d75ecbc15bae")
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """No-op: this revision exists only to rejoin three heads."""


def downgrade() -> None:
    """No-op: reversing a merge just restores the fork."""
