"""Give each member a pinned shortlist on the inventory items list.

Revision ID: f2a91c7d4e86
Revises: d3f8b6a24c91
Create Date: 2026-09-07 15:00:00.000000

The items list is alphabetical, and for a quartermaster a handful of items --
the Class B polos, the duty boots -- carry nearly all the traffic while sitting
scattered between things touched once a year. ``inventory_item_pins`` lets a
member hoist their own working set to the top of that list.

Per-user rather than per-organization: two quartermasters running different
supply lines front different gear, and one curating their list must not
reorder the other's page. ``organization_id`` is denormalized from the item so
every read is org-scoped without joining ``inventory_items``.

The unique constraint on ``(user_id, item_id)`` is not merely hygiene: it is
what keeps the outer join in ``InventoryService.get_items`` at most 1:1, so
hoisting pins cannot multiply rows and inflate the list's total count.

No backfill. An empty table is the correct starting state -- the absence of a
pin means "not pinned", never "unknown" -- so the downgrade drops the table and
leaves a database identical to the one that existed before this revision.
"""

import sqlalchemy as sa
from alembic import op

revision = "f2a91c7d4e86"
down_revision = "d3f8b6a24c91"
branch_labels = None
depends_on = None

TABLE = "inventory_item_pins"


def _has_table(table: str) -> bool:
    return table in sa.inspect(op.get_bind()).get_table_names()


def upgrade() -> None:
    # Guarded even though this revision is what creates the table: application
    # startup runs ``Base.metadata.create_all()``, which builds it from the
    # model, so a fresh install can reach this revision with the table already
    # present (CLAUDE.md pitfall #26).
    if _has_table(TABLE):
        return

    op.create_table(
        TABLE,
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("organization_id", sa.String(length=36), nullable=False),
        sa.Column("user_id", sa.String(length=36), nullable=False),
        sa.Column("item_id", sa.String(length=36), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False, server_default="0"),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=True,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=True,
        ),
        sa.ForeignKeyConstraint(
            ["organization_id"], ["organizations.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["item_id"], ["inventory_items.id"], ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "item_id", name="uq_item_pin_user_item"),
    )
    op.create_index(
        "idx_item_pins_org_user_position",
        TABLE,
        ["organization_id", "user_id", "position"],
    )


def downgrade() -> None:
    if not _has_table(TABLE):
        return
    op.drop_index("idx_item_pins_org_user_position", table_name=TABLE)
    op.execute(f"DROP TABLE IF EXISTS {TABLE}")
