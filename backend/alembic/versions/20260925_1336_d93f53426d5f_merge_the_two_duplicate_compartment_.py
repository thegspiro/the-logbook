"""Merge the two parallel merges of the compartment and email heads.

Revision ID: d93f53426d5f
Revises: 169772734c90, a0e4764c1b55

Two sessions each fixed the same double head at the same time, so
``169772734c90`` (thegspiro/the-logbook#2715) and ``a0e4764c1b55``
(thegspiro/the-logbook#2717) are both merges over the same revisions, and with
both on ``main`` there are two heads again. This joins them. It has no
schema effect: everything below it already ran, and Alembic applies each
revision once however many paths reach it.
"""

revision = "d93f53426d5f"
down_revision = ("169772734c90", "a0e4764c1b55")
branch_labels = None
depends_on = None


def upgrade() -> None:
    """No-op: this revision exists only to rejoin two branches."""


def downgrade() -> None:
    """No-op: splitting the branches again requires no schema change."""
