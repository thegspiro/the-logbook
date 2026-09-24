"""Merge the consent-default and member-service-periods heads.

Revision ID: 067acb374e56
Revises: b4014469fd76, 500a63596f66

``b4014469fd76`` (default ``user_consents.granted`` to false) and
``500a63596f66`` (member service periods) were both written against
``5e1c0b9f7a42``. The consent branch had been repointed onto
``500a63596f66`` before merging, but the pull request merged at the commit
before that repoint, so both landed on ``main`` as siblings and
``alembic upgrade head`` refused to run.

Both are published, so neither can be edited. This revision joins them and
has no schema effect of its own; the parents touch unrelated tables
(``user_consents``; ``member_service_periods``) and apply in either
order.
"""

revision = "067acb374e56"
down_revision = ("b4014469fd76", "500a63596f66")
branch_labels = None
depends_on = None


def upgrade() -> None:
    """No-op: this revision exists only to rejoin two branches."""


def downgrade() -> None:
    """No-op: splitting the branches again requires no schema change."""
