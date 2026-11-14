"""Rejoin the voter-rule reasons head and the waiver follow-ups head

Both built on ``9e79851e9a62``, and merging ``main`` (with the waiver
follow-ups) into the voter-rule exceptions branch (#4270) left two heads, so
``alembic upgrade head`` refuses to run (the backend migrates itself on
startup):

- ``e6f00308856d`` (#4270): ``elections.eligibility_override_reason``;
- ``5e2b9c7d1a40`` (main): the attendance waiver request follow-ups.

They touch different tables, so this is a pure join with no schema effect.

Revision ID: 0f1564b3784b
Revises: 5e2b9c7d1a40, e6f00308856d
Create Date: 2026-11-14 00:03:00
"""

# revision identifiers
revision = "0f1564b3784b"
down_revision = ("5e2b9c7d1a40", "e6f00308856d")
branch_labels = None
depends_on = None


def upgrade() -> None:
    """No-op: this revision exists only to rejoin two branches."""


def downgrade() -> None:
    """No-op: splitting the branches again requires no schema change."""
