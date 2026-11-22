"""Merge the leave-approver-cover and outreach/volunteer-RSVP heads

``a9763f96e072`` (leave requests: approver cover and chief routing) and
``3f93727e84ba`` (the outreach-rename / volunteer-RSVP merge) both landed on
main separately and left two heads, so ``alembic upgrade head`` refused to
run. ``a9763f96e072`` only touches the leave-request ``votes``/``requests``
tables; neither head writes a table the other does, so the merge carries no
operations.

Revision ID: 67f75ff116ae
Revises: 3f93727e84ba, a9763f96e072
Create Date: 2026-11-22 04:41:20.451416

"""

from typing import Sequence, Union

# revision identifiers, used by Alembic.
revision: str = "67f75ff116ae"
down_revision: Union[str, None] = ("3f93727e84ba", "a9763f96e072")
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
