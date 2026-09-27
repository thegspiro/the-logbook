"""merge the admin-hours withdrawn and external shift hours heads

Two pull requests built on ``b795d1b3401b`` and both merged, leaving two
heads:

* #2748 added ``8c47e8945f69`` (withdrawn status for admin-hours entries).
* #2749 added ``f03c9f236904`` (hours logged on shifts outside the department).

Alembic refuses ``upgrade head`` while more than one head exists. Nothing is
created here — the two branches touch unrelated tables, and every revision
below already ran on one side or the other.

Revision ID: c4a1e7d2b9f3
Revises: 8c47e8945f69, f03c9f236904
Create Date: 2026-09-27 14:20:00

"""

from typing import Sequence, Union

# revision identifiers, used by Alembic.
revision: str = "c4a1e7d2b9f3"
down_revision: Union[str, Sequence[str], None] = ("8c47e8945f69", "f03c9f236904")
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """No-op: a merge revision only reconciles the revision graph."""


def downgrade() -> None:
    """No-op: splitting the graph back into two heads needs no DDL."""
