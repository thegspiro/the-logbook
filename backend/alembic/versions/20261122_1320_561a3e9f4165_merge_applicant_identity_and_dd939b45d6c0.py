"""Merge 809893462b67 and dd939b45d6c0, two joins of the same pair

``809893462b67`` (an applicant's own identity edits, ADV2-10) and
``dd939b45d6c0`` each revise ``7d2e4b81c5a3`` and ``85680aed8332``, which
were themselves two merges of one pair. Both landed on 2026-11-22, so
``alembic upgrade head`` refuses to run until they are joined.

Nothing is created here. Each revision already ran its own DDL, and Alembic
runs each revision exactly once however many merge paths reach it.

Revision ID: 561a3e9f4165
Revises: 809893462b67, dd939b45d6c0
Create Date: 2026-11-22 13:20:00.000000
"""

from typing import Sequence, Union

# revision identifiers, used by Alembic.
revision: str = "561a3e9f4165"
# Kept on one line for the migration-chain validators, which read it line by
# line.
# fmt: off
down_revision: Union[str, Sequence[str], None] = ("809893462b67", "dd939b45d6c0")
# fmt: on
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """No-op: a merge revision only reconciles the revision graph."""


def downgrade() -> None:
    """No-op: splitting the graph back into two heads needs no DDL."""
