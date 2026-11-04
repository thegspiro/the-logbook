"""Merge the historical-import, interview-email and compliance-drop heads.

Revision ID: 8ce1d53a1c5a
Revises: 34f113ec86e3, 4f1f4921a052, d75ecbc15bae
Create Date: 2026-11-04 13:46:40.279217

Three independent migrations were each written with ``down_revision =
"b5e906ebdd7d"`` (directly, or one hop down through
``c0ae312b2385``), forking the chain into three heads:

- ``34f113ec86e3`` (historical import: administrative hours) — via
  ``c0ae312b2385`` (historical data import)
- ``4f1f4921a052`` (interview requested email)
- ``d75ecbc15bae`` (drop the folder-backfill bookkeeping and unused
  compliance tables)

This revision rejoins them and has no schema effect of its own. The three
are independent — distinct tables/columns on each side (admin hours entries
and historical-import JSON columns; two template-type enums; a fixed list of
dropped tables) — and every one of them guards its own change with an
existence/idempotency check, so they apply in any order.
"""

# revision identifiers
revision = "8ce1d53a1c5a"
down_revision = ("34f113ec86e3", "4f1f4921a052", "d75ecbc15bae")
branch_labels = None
depends_on = None


def upgrade() -> None:
    """No-op: this revision exists only to rejoin three branches."""


def downgrade() -> None:
    """No-op: splitting the branches again requires no schema change."""
