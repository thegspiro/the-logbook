"""Merge the outside-shift-evaluation and screening-relink migration heads

Two revisions were developed in parallel, each on 4c8e2f61a9d7, and merged
to main separately, so the revision graph had two heads and
``alembic upgrade head`` refused to run (the backend migrates itself on
startup):

- 400ce5009f5e: ``external_agencies.evaluate_shifts`` and the
  ``shift_evaluations`` outside-shift columns;
- beedcad5b36a: files a transferred prospect's screening records under the
  member as well.

This revision merges them. It has no schema effect of its own. The parents
touch different tables, so they apply in either order.

Revision ID: bbe101d29964
Revises: 400ce5009f5e, beedcad5b36a
Create Date: 2026-11-02 19:00:00.000000
"""

# revision identifiers
revision = "bbe101d29964"
down_revision = ("400ce5009f5e", "beedcad5b36a")
branch_labels = None
depends_on = None


def upgrade() -> None:
    """No-op: this revision exists only to rejoin two branches."""


def downgrade() -> None:
    """No-op: splitting the branches again requires no schema change."""
