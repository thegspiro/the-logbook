"""merge the admin hours and external shift hours heads

Two branches each added a revision on top of ``b795d1b3401b`` and merged
fourteen seconds apart:

* #2748 added ``8c47e8945f69`` (the admin hours ``withdrawn`` status).
* #2749 added ``f03c9f236904`` (external shift hours).

Each is valid on its own; together they leave two heads, and
``alembic upgrade head`` refuses to run. This joins them. Nothing is created
here — each revision below already runs on its own side, and Alembic applies a
revision once however many paths reach it.

Revision ID: c6863c42928f
Revises: 8c47e8945f69, f03c9f236904
Create Date: 2026-09-27 13:57:33.026542

"""

from typing import Sequence, Union

# revision identifiers, used by Alembic.
revision: str = "c6863c42928f"
down_revision: Union[str, Sequence[str], None] = ("8c47e8945f69", "f03c9f236904")
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """No-op: a merge revision only reconciles the revision graph."""


def downgrade() -> None:
    """No-op: splitting the graph back into two heads needs no DDL."""
