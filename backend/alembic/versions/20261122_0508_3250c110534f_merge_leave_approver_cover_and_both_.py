"""Merge the three heads left on main on 2026-11-22

``a9763f96e072`` (leave requests: approver cover and Chief routing) revises
``c6c2a665a8fe``. Separately, the fork of ``1a5c18b46791`` (outreach rename)
and ``c7e1a94d2f58`` (volunteer RSVPs as crew) drew two merge revisions with
the same parents, ``3f93727e84ba`` and ``6a94645761c1``, which merged to main
from different pull requests. That left three heads and an
``alembic upgrade head`` that refuses to run.

All three are joined here in one revision rather than a pair at a time, so
there is one merge to land (docs/rules/migrations.md, "One merge revision per
fork"). Neither duplicate merge is removed: an installation that upgraded
while one of them was the only head has it stamped, and this revision
reaches every such database whichever of the three it has applied.

Every parent's operations are independent of the others' (``leave_requests``,
``leave_request_votes`` and ``leave_approver_covers`` against ``positions``,
``email_templates``, ``event_rsvps`` and ``shift_assignments``), so the merge
carries none.

Revision ID: 3250c110534f
Revises: 3f93727e84ba, 6a94645761c1, a9763f96e072
Create Date: 2026-11-22 05:08:24.839609

"""

from typing import Sequence, Union

# revision identifiers, used by Alembic.
revision: str = "3250c110534f"
down_revision = ("3f93727e84ba", "6a94645761c1", "a9763f96e072")
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
