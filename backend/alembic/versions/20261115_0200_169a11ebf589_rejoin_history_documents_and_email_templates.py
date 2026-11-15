"""Rejoin the history documents head and the email templates head

Two revisions merged on 2026-11-14 both continued from the history chain and
left ``main`` with two heads, so ``alembic upgrade head`` refuses to run (the
backend migrates itself on startup):

- ``4d8e2b6f1c93`` (#4313): history documents;
- ``c4e81b7a2d95`` (#4295): editable election and minutes email templates.

They touch different tables, so this is a pure join with no schema effect.

Revision ID: 169a11ebf589
Revises: 4d8e2b6f1c93, c4e81b7a2d95
Create Date: 2026-11-15 02:00:00
"""

# revision identifiers
revision = "169a11ebf589"
down_revision = ("4d8e2b6f1c93", "c4e81b7a2d95")
branch_labels = None
depends_on = None


def upgrade() -> None:
    """No-op: this revision exists only to rejoin two branches."""


def downgrade() -> None:
    """No-op: splitting the branches again requires no schema change."""
