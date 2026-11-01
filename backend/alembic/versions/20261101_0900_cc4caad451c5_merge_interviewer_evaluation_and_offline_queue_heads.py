"""Merge the interviewer, evaluation-grant and offline-queue migration heads

Three revisions were developed in parallel, each on 5781476f2012, and merged
to main separately, so the revision graph had three heads and
``alembic upgrade head`` refused to run (the backend migrates itself on
startup):

- aefb58788235: ``prospect_interviews.interviewer_positions`` and the
  ``application_needs_attention`` email template type;
- b65eaef983b9: ``evaluations.configure`` / ``evaluations.manage`` on the
  seeded Chief position;
- e9bfa68963ce: ``training_submissions.client_request_id``.

This revision merges them. It has no schema effect of its own. The parents
touch different tables and columns, so they apply in any order.

Revision ID: cc4caad451c5
Revises: aefb58788235, b65eaef983b9, e9bfa68963ce
Create Date: 2026-11-01 09:00:00.000000
"""

# revision identifiers
revision = "cc4caad451c5"
down_revision = ("aefb58788235", "b65eaef983b9", "e9bfa68963ce")
branch_labels = None
depends_on = None


def upgrade() -> None:
    """No-op: this revision exists only to rejoin three branches."""


def downgrade() -> None:
    """No-op: splitting the branches again requires no schema change."""
