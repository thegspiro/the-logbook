"""Merge the voter-eligibility and follow-up-form migration heads

The voter-eligibility chain (e1a7c4b2d9f3 -> b3d58e0c71a4 -> c7e2a91f4d36)
and the follow-up form reminders (30e5b112ec00) were developed in parallel
and both chain off f34e25e2c820, so merging them left the revision graph
with two heads and made ``alembic upgrade head`` ambiguous.

This revision merges the two branches. It has no schema effect of its own;
the two parents are independent (elections / users columns vs.
prospect_form_requests and the template-type enums) and apply in either
order.

Revision ID: d4b1f6a2c9e8
Revises: 30e5b112ec00, c7e2a91f4d36
Create Date: 2026-10-29 18:00:00.000000
"""

# revision identifiers
revision = "d4b1f6a2c9e8"
down_revision = ("30e5b112ec00", "c7e2a91f4d36")
branch_labels = None
depends_on = None


def upgrade() -> None:
    """No-op: this revision exists only to rejoin two branches."""


def downgrade() -> None:
    """No-op: splitting the branches again requires no schema change."""
