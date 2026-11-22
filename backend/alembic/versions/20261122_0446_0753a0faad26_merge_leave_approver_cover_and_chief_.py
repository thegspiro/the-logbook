"""Merge the leave-approver-cover/chief-routing head with the outreach/RSVP merge head

``a9763f96e072`` (leave approver cover and chief routing) revises
``c6c2a665a8fe``, which is itself the first of two merge revisions already
reconciling the outreach-rename/volunteer-RSVP fork; ``3f93727e84ba`` is a
second, independent merge revision for that same fork, added on a different
branch. Both reached main, leaving two heads and an ``alembic upgrade head``
that refuses to run. Neither touches a table the other writes (leave
requests/votes/covers vs. outreach positions/event RSVPs), so the merge
carries no operations.

Revision ID: 0753a0faad26
Revises: a9763f96e072, 3f93727e84ba
Create Date: 2026-11-22 04:46:37.317123

"""

from typing import Sequence, Union

# revision identifiers, used by Alembic.
revision: str = "0753a0faad26"
down_revision: Union[str, None] = ("a9763f96e072", "3f93727e84ba")
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
