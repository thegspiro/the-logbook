"""merge label printer and event RSVP heads

Both branches chained off a17c4e9d2b61 independently, so the two arrived on
main as separate heads and `alembic upgrade head` refused to pick one.

A merge rather than re-parenting the label-printer migrations: the branch has
been pushed and may already have been applied somewhere, and moving its parent
would leave a database stamped at c7d1f4a83e29 skipping d5e82c0a7f31 forever —
alembic would see itself at head and do nothing.

Revision ID: e4b91c7d2a58
Revises: c7d1f4a83e29, d5e82c0a7f31
Create Date: 2026-08-23 22:30:00.000000

"""

from typing import Sequence, Union

# revision identifiers, used by Alembic.
revision: str = "e4b91c7d2a58"
# Keep the tuple on one line: the repository's lightweight migration-chain
# validators intentionally parse revision metadata one physical line at a time.
# fmt: off
down_revision: Union[str, None] = ("c7d1f4a83e29", "d5e82c0a7f31")
# fmt: on
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
