"""Merge the outreach-rename and volunteer-RSVP heads

The outreach vocabulary rename (1a5c18b46791) and the volunteer-RSVP
``is_volunteer`` column (c7e1a94d2f58) both revise 3daf47506e9e and merged to
main separately, leaving two heads and an ``alembic upgrade head`` that
refuses to run. Neither touches a table the other writes, so the merge
carries no operations.

Revision ID: 3f93727e84ba
Revises: 1a5c18b46791, c7e1a94d2f58
Create Date: 2026-11-22 01:53:20.954651

"""

from typing import Sequence, Union

# revision identifiers, used by Alembic.
revision: str = "3f93727e84ba"
down_revision: Union[str, None] = ("1a5c18b46791", "c7e1a94d2f58")
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
