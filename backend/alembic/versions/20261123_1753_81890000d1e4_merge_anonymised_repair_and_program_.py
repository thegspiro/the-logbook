"""Merge the anonymised-repair and program-requirement-reopened heads

``1f3a6c2d9e40`` (relabel path-less attachment names and re-excuse waivers
for anonymised members) and ``bfb747c095c3`` (add the
``program_requirement_reopened`` email template type) both landed on main
off the same parent (``e3b8d61f4a27``) and left two heads, so
``alembic upgrade head`` refused to run. Neither touches a table or column
the other does, so the merge carries no operations.

Revision ID: 81890000d1e4
Revises: 1f3a6c2d9e40, bfb747c095c3
Create Date: 2026-11-23 17:53:04.940584

"""

from typing import Sequence, Union

# revision identifiers, used by Alembic.
revision: str = "81890000d1e4"
down_revision: Union[str, None] = ("1f3a6c2d9e40", "bfb747c095c3")
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
