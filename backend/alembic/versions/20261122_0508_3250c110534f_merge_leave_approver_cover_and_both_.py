"""Merge the two heads left on main on 2026-11-22

The fork of ``1a5c18b46791`` (outreach rename) and ``c7e1a94d2f58`` (volunteer
RSVPs as crew) drew two merge revisions with the same parents,
``3f93727e84ba`` and ``6a94645761c1``, which reached main from different pull
requests. ``67f75ff116ae`` (#4547) then merged ``3f93727e84ba`` with
``a9763f96e072`` (leave requests: approver cover and Chief routing). That
leaves two heads, ``6a94645761c1`` and ``67f75ff116ae``, and an
``alembic upgrade head`` that refuses to run.

This joins them. Neither duplicate merge is removed: an installation that
upgraded while one of them was the only head has it stamped, and this
revision reaches every such database whichever of them it has applied.

The revisions under both heads touch different tables (``leave_requests``,
``leave_request_votes`` and ``leave_approver_covers`` against ``positions``,
``email_templates``, ``event_rsvps`` and ``shift_assignments``), so the merge
carries no operations.

Revision ID: 3250c110534f
Revises: 6a94645761c1, 67f75ff116ae
Create Date: 2026-11-22 05:08:24.839609

"""

from typing import Sequence, Union

# revision identifiers, used by Alembic.
revision: str = "3250c110534f"
down_revision = ("6a94645761c1", "67f75ff116ae")
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
