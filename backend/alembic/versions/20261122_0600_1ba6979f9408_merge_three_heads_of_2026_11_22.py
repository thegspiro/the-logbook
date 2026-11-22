"""Merge the three heads main carried on 2026-11-22

``3f93727e84ba`` and ``6a94645761c1`` are two merges of the same pair
(the outreach rename and the volunteer-RSVP column), landed by #4543 and #4533
separately; ``a9763f96e072`` (leave approver cover and Chief routing, #4531)
branched beside them. Each was a single head in its own branch's CI, so all
three reached main and ``alembic upgrade head`` refuses to run. None of the
three touches a table another writes, and Alembic runs each revision once
however many merge paths reach it, so this merge carries no operations.

Revision ID: 1ba6979f9408
Revises: 3f93727e84ba, 6a94645761c1, a9763f96e072
Create Date: 2026-11-22 06:00:00.000000

"""

from typing import Sequence, Union

# revision identifiers, used by Alembic.
revision: str = "1ba6979f9408"
# Keep the tuple on one line: the repository's lightweight migration-chain
# validators parse revision metadata one physical line at a time.
# fmt: off
down_revision: Union[str, Sequence[str], None] = ("3f93727e84ba", "6a94645761c1", "a9763f96e072")
# fmt: on
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
