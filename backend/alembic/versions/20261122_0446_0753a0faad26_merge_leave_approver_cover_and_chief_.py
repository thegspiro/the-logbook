"""Merge the leave-approver-cover/chief-routing head with both outreach/RSVP merge heads

``a9763f96e072`` (leave approver cover and chief routing) revises
``c6c2a665a8fe``, which is itself the first of three independent merge
revisions reconciling the same outreach-rename/volunteer-RSVP fork
(``1a5c18b46791``/``c7e1a94d2f58``, both revising ``3daf47506e9e``):
``c6c2a665a8fe``, ``3f93727e84ba`` and ``6a94645761c1`` each merge that same
pair, added on three different branches that all forked before any of the
other two reached main. This migration was first written to join only
``a9763f96e072`` and ``3f93727e84ba``; before it reached main, ``main``
gained the third (``6a94645761c1``) as well, re-forking the chain again, so
this revision now joins all three live heads directly rather than adding
yet another merge-of-a-merge commit. None of the three touches a table
either of the others writes (leave requests/votes/covers vs. outreach
positions/email templates vs. event RSVPs/shift assignments), so the merge
carries no operations.

Revision ID: 0753a0faad26
Revises: a9763f96e072, 3f93727e84ba, 6a94645761c1
Create Date: 2026-11-22 04:46:37.317123

"""

from typing import Sequence, Union

# revision identifiers, used by Alembic.
revision: str = "0753a0faad26"
down_revision: Union[str, None] = ("a9763f96e072", "3f93727e84ba", "6a94645761c1")
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
