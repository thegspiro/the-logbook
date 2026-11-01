"""Merge the evaluation-grant and interviewer-position migration heads

The evaluation setup grant (b65eaef983b9, #3888) and the interviewer
positions / attention email change (aefb58788235, #3893) were developed in
parallel and both revise 5781476f2012, so merging them left the revision
graph with two heads and made ``alembic upgrade head`` ambiguous.

This revision merges the two branches. It has no schema effect of its own;
the two parents are independent (a permission added to the seeded Chief
position vs. interviewer position and attention-email columns) and apply in
either order.

Revision ID: f2c8d41a7e63
Revises: aefb58788235, b65eaef983b9
Create Date: 2026-11-01 15:45:00.000000
"""

# revision identifiers
revision = "f2c8d41a7e63"
down_revision = ("aefb58788235", "b65eaef983b9")
branch_labels = None
depends_on = None


def upgrade() -> None:
    """No-op: this revision exists only to rejoin two branches."""


def downgrade() -> None:
    """No-op: splitting the branches again requires no schema change."""
