"""Rejoin the heads from #4033, #4036 and the interest-form name fix

Three migrations left ``alembic upgrade head`` with more than one head, so
the backend, which migrates itself on startup, would refuse to boot:

- ``514dca8e6de3`` (#4033): ``historical_imports.training_settings``;
- ``67fac0bf1c09``: unescapes interest-form applicant names, built on
  ``d6906e3dd76c`` and merged to ``main`` beside #4033;
- ``89cfef37cca8`` (#4036): the session-attendance requirement type.

They touch unrelated tables, so this is a pure join with no schema effect.

Revision ID: 73026d48caff
Revises: 514dca8e6de3, 67fac0bf1c09, 89cfef37cca8
Create Date: 2026-11-04 20:50:00
"""

# revision identifiers
revision = "73026d48caff"
down_revision = ("514dca8e6de3", "67fac0bf1c09", "89cfef37cca8")
branch_labels = None
depends_on = None


def upgrade() -> None:
    """No-op: this revision exists only to rejoin three branches."""


def downgrade() -> None:
    """No-op: splitting the branches again requires no schema change."""
