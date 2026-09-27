"""Merge the offline audit submission id and the duplicate compartment/email merge.

Revision ID: a0e4764c1b55
Revises: 883c6309dcec, 31e8ad77527b

``883c6309dcec`` and ``ff6730a7db54`` were written in parallel and both
join the same two heads (NFC compartment tags and the email masthead shell),
and ``31e8ad77527b`` (the offline shelf-audit submission id) followed
``ff6730a7db54``. With both merged, ``main`` again has two heads and
``alembic upgrade head`` refuses to run. This revision joins them and has
no schema effect of its own; everything below it already ran on one side, and
Alembic applies each revision once however many paths reach it.
"""

revision = "a0e4764c1b55"
down_revision = ("883c6309dcec", "31e8ad77527b")
branch_labels = None
depends_on = None


def upgrade() -> None:
    """No-op: this revision exists only to rejoin two branches."""


def downgrade() -> None:
    """No-op: splitting the branches again requires no schema change."""
