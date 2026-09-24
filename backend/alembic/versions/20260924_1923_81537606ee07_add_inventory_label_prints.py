"""Keep a history of confirmed inventory label prints.

``inventory_items.label_printed_at`` / ``label_printed_by`` hold only the
latest confirmation, and are cleared when the value a label encodes changes.
``inventory_label_prints`` keeps one row per item per confirmation, so the item
page can show every time a label was printed, by whom, and what it encoded.

Nothing is backfilled beyond what can be known: an item whose latest print is
still recorded on the item gets that one row, so its history does not start
empty. Earlier prints were never stored and cannot be recovered.

The create is skipped when the table is already there, which it is on an
installation that started the app (``create_all`` builds it from the model)
before running this revision.

**Reversible.** The downgrade drops the table. The latest print per item stays
on ``inventory_items``, so only the older history is lost.

Revision ID: 81537606ee07
Revises: 941e1251ad74
Create Date: 2026-09-24 19:23:03.904331
"""

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "81537606ee07"
down_revision = "941e1251ad74"
branch_labels = None
depends_on = None

_TABLE = "inventory_label_prints"


def _has_table(name: str) -> bool:
    return name in sa.inspect(op.get_bind()).get_table_names()


def upgrade() -> None:
    if _has_table(_TABLE):
        return
    op.create_table(
        _TABLE,
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "organization_id",
            sa.String(36),
            sa.ForeignKey("organizations.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "item_id",
            sa.String(36),
            sa.ForeignKey("inventory_items.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "printed_by",
            sa.String(36),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "printed_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column("label_value", sa.String(255), nullable=True),
    )
    op.create_index("idx_label_prints_item_printed", _TABLE, ["item_id", "printed_at"])
    op.create_index("idx_label_prints_org", _TABLE, ["organization_id"])

    # Seed each item's still-recorded latest print. UUID() is evaluated per
    # row on both MySQL 8.0 and MariaDB 10.11.
    op.execute(f"""
        INSERT INTO {_TABLE}
            (id, organization_id, item_id, printed_by, printed_at)
        SELECT UUID(), organization_id, id, label_printed_by, label_printed_at
        FROM inventory_items
        WHERE label_printed_at IS NOT NULL
        """)


def downgrade() -> None:
    op.execute(f"DROP TABLE IF EXISTS {_TABLE}")
