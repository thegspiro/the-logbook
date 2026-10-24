"""Merge the minutes vote-detail and Google Workspace/medical storage heads.

Revision ID: 361a40316340
Revises: 9ce470b513ae, dc3c105464c1
Create Date: 2026-10-16 11:06:00.000000

``9ce470b513ae`` (minutes motions vote detail) and ``dc3c105464c1`` (merging
the earlier Google Workspace provisioning / medical storage auto-match fork)
were both written with ``down_revision = ("61dfbcc23cba", "58522b08f6a7")`` —
``9ce470b513ae``'s own docstring claims to join that fork, but setting the
same parent pair as an unrelated, independently-written revision makes it a
second branch off those two parents rather than a merge of them, so main
ended up with two heads again (``9ce470b513ae`` and ``dc3c105464c1``) instead
of one.

This revision rejoins them and has no schema effect of its own. The two
parents are independent — three nullable columns on ``meeting_motions`` on
one side, nothing (``dc3c105464c1`` is itself a no-op merge) on the other —
so they apply in either order.
"""

# revision identifiers
revision = "361a40316340"
down_revision = ("9ce470b513ae", "dc3c105464c1")
branch_labels = None
depends_on = None


def upgrade() -> None:
    """No-op: this revision exists only to rejoin two branches."""


def downgrade() -> None:
    """No-op: splitting the branches again requires no schema change."""
