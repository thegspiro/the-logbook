"""Merge heads: QuickBooks export tracking and shift-import archival

Two unrelated feature PRs (QuickBooks export tracking, 3f3bd6f3c7e4; shift
history import archival, 990e288940bc) both branched off 4b7e1f0c9a2d and
merged to main minutes apart, leaving two heads. This revision merges them;
it makes no schema change of its own.

Revision ID: 727ad5f31385
Revises: 3f3bd6f3c7e4, 990e288940bc
Create Date: 2026-10-11 14:46:32.724105

"""

from typing import Sequence, Union

# revision identifiers, used by Alembic.
revision: str = "727ad5f31385"
down_revision: Union[str, None] = ("3f3bd6f3c7e4", "990e288940bc")
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
