"""merge the dashboard-pulse and practical-skills heads

Joins users.dashboard_pulse (a51a4e1d2443) with
training_module_configs.practical_skills_method (bde76b481a16). Both were cut
from 3c9c5025a380 and merged to main separately, leaving two heads, which
stops ``alembic upgrade head``. They touch different tables, so they do not
depend on each other and the merge itself changes nothing.

Revision ID: 7a849409c1d0
Revises: a51a4e1d2443, bde76b481a16
Create Date: 2026-10-12 21:45:00.000000

"""

from typing import Sequence, Union

# revision identifiers, used by Alembic.
revision: str = "7a849409c1d0"
down_revision: Union[str, None] = ("a51a4e1d2443", "bde76b481a16")
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
