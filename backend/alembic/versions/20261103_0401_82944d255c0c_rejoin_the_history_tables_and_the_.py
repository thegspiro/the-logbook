"""Rejoin the History tables and the second fork fix

``02c94bb742d6`` (the History grant migration, PR #3966) and ``cbb9726e8af7``
(PR #3965) each rejoined the same two heads, ``5438939506b9`` and
``b840c0d2b961``, and both reached ``main`` — leaving ``038ade7a5cd0`` and
``cbb9726e8af7`` as two heads. Neither parent depends on the other, so this is
a pure join.

Revision ID: 82944d255c0c
Revises: 038ade7a5cd0, cbb9726e8af7
Create Date: 2026-11-03 04:01:58.604339

"""

from typing import Sequence, Union

# revision identifiers, used by Alembic.
revision: str = "82944d255c0c"
down_revision: Union[str, Sequence[str], None] = ("038ade7a5cd0", "cbb9726e8af7")
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """No-op: this revision exists only to rejoin two heads."""


def downgrade() -> None:
    """No-op: reversing a merge just restores the fork."""
