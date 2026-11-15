"""Rejoin the history documents head and the email-templates head

Two branches merged to ``main`` on 2026-11-14 each added a child to a
different revision, leaving two heads, so ``alembic upgrade head`` refuses to
run (the backend migrates itself on startup) and every pull request's
migration, integration and contract jobs fail before a test starts:

- ``4d8e2b6f1c93`` — History phase 4: documents (on ``7a3c9e1d5b42``);
- ``c4e81b7a2d95`` — election and minutes emails become editable templates
  (on ``7735ee22aa76``).

They touch different tables, so this is a pure join with no schema effect.

Revision ID: 917691a82f04
Revises: 4d8e2b6f1c93, c4e81b7a2d95
Create Date: 2026-11-15 02:10:45
"""

# revision identifiers
revision = "917691a82f04"
down_revision = ("4d8e2b6f1c93", "c4e81b7a2d95")
branch_labels = None
depends_on = None


def upgrade() -> None:
    """No-op: this revision exists only to rejoin two branches."""


def downgrade() -> None:
    """No-op: splitting the branches again requires no schema change."""
