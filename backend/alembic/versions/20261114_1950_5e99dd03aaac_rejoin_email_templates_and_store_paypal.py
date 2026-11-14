"""Rejoin the election/minutes email templates head and the store PayPal head

Both descend from ``7735ee22aa76``, and main was left with two heads once
#4295 and the History migrations were both merged:

- ``c4e81b7a2d95`` (#4295): election and minutes emails become editable
  templates;
- ``053d3e96b4fa`` (#4301): ``store_settings.paypal_use_connected``, which
  builds on History phase 4's ``4d8e2b6f1c93`` (itself on phase 3's
  ``7a3c9e1d5b42``), the other head on main.

With two heads ``alembic upgrade head`` refuses to run, and the backend
migrates itself on startup. They touch different tables, so this is a pure
join with no schema effect.

Revision ID: 5e99dd03aaac
Revises: c4e81b7a2d95, 053d3e96b4fa
Create Date: 2026-11-14 19:50:00
"""

# revision identifiers
revision = "5e99dd03aaac"
down_revision = ("c4e81b7a2d95", "053d3e96b4fa")
branch_labels = None
depends_on = None


def upgrade() -> None:
    """No-op: this revision exists only to rejoin two branches."""


def downgrade() -> None:
    """No-op: splitting the branches again requires no schema change."""
