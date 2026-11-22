"""Merge 809893462b67 and dd939b45d6c0, two children of the same pair

Both revisions sit directly on ``7d2e4b81c5a3`` and ``85680aed8332``.
``809893462b67`` (#4542, applicants' identity edits) was repointed onto that
pair, and ``dd939b45d6c0`` (#4557) is a no-op join of the same pair. Each
landed as the single head of its own branch, so main carries two heads and
``alembic upgrade head`` refuses to run. This joins them and carries no
operations.

Revision ID: a72ed2127925
Revises: 809893462b67, dd939b45d6c0
Create Date: 2026-11-22 13:15:00.000000

"""

from typing import Sequence, Union

# revision identifiers, used by Alembic.
revision: str = "a72ed2127925"
# Keep the tuple on one line: the repository's lightweight migration-chain
# validators parse revision metadata one physical line at a time.
# fmt: off
down_revision: Union[str, Sequence[str], None] = ("809893462b67", "dd939b45d6c0")
# fmt: on
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
