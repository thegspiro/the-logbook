"""Org chart: many people per seat, and seats linked to a role or rank

Three changes to Governance -> Organizational Chart, all driven by the same
observation: a box on a real org chart is a *seat*, and a seat is not the same
thing as one person.

1. ``org_chart_node_holders``. A seat now lists any number of people. Trustees,
   co-chairs, two assistant chiefs and a three-person board were previously
   forced into sibling rows, which duplicated the seat's area of responsibility
   onto each of them and made the chart claim a hierarchy the department does
   not have.

2. ``position_id`` / ``rank_code``. A seat may now be linked to a corporate
   position or an operational rank, so the Chief's box lists whoever currently
   holds the Chief's role without anybody remembering to edit two screens after
   an election. The link *supplements* the seat's own list rather than replacing
   it, and the *shape* of the chart stays hand-curated — see the model docstring
   for why the permission tree and the real chain of command genuinely
   disagree.

3. The old single-holder columns ``user_id`` and ``display_name`` are backfilled
   into the new table and dropped. Leaving them as "the first holder" would give
   the chart two places to answer the same question, which is the shape pitfall
   #20 is about.

**The downgrade is lossy and cannot be made otherwise.** It restores the single
holder columns from each seat's *first* holder and drops the rest: the old shape
has nowhere to put a second person. A department that has listed co-chairs since
the upgrade loses everybody but the first, and a seat that followed a position
comes back empty rather than naming whoever held that position at the time.

Revision ID: a7c93f21d5b8
Revises: f2a91c7d6b04
Create Date: 2026-08-25 12:00:00.000000

"""

import uuid
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "a7c93f21d5b8"
down_revision: Union[str, None] = "f2a91c7d6b04"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_NODES = "org_chart_nodes"
_HOLDERS = "org_chart_node_holders"


def _column_names(inspector, table: str) -> set:
    return {col["name"] for col in inspector.get_columns(table)}


def _drop_fks_on(bind, inspector, table: str, column: str) -> None:
    """Drop every FK constraint that covers ``column``.

    MySQL refuses to drop a column an FK still references (error 1553), and the
    constraint name is server-generated, so it has to be read back rather than
    assumed.
    """
    for fk in inspector.get_foreign_keys(table):
        if column in (fk.get("constrained_columns") or []) and fk.get("name"):
            bind.execute(sa.text(f"ALTER TABLE {table} DROP FOREIGN KEY {fk['name']}"))


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    # Absent on a fresh install, where startup create_all materializes the
    # current models after migrations run — there is nothing to migrate.
    if _NODES not in inspector.get_table_names():
        return

    columns = _column_names(inspector, _NODES)

    if "position_id" not in columns:
        # SET NULL, so nullable — MySQL rejects SET NULL on a NOT NULL column
        # with error 1830 (pitfall #2). Deleting a role must leave the seat
        # standing and resolving as vacant, not delete a branch of the chart.
        op.add_column(
            _NODES,
            sa.Column("position_id", sa.String(length=36), nullable=True),
        )
        op.create_foreign_key(
            "fk_org_chart_nodes_position",
            _NODES,
            "positions",
            ["position_id"],
            ["id"],
            ondelete="SET NULL",
        )
    if "rank_code" not in columns:
        op.add_column(
            _NODES,
            sa.Column("rank_code", sa.String(length=100), nullable=True),
        )

    if _HOLDERS not in inspector.get_table_names():
        op.create_table(
            _HOLDERS,
            sa.Column("id", sa.String(length=36), nullable=False),
            sa.Column("node_id", sa.String(length=36), nullable=False),
            sa.Column("user_id", sa.String(length=36), nullable=True),
            sa.Column("display_name", sa.String(length=200), nullable=True),
            sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
            sa.Column(
                "created_at",
                sa.DateTime(timezone=True),
                server_default=sa.func.now(),
                nullable=False,
            ),
            sa.ForeignKeyConstraint(["node_id"], [f"{_NODES}.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="SET NULL"),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index(
            "ix_org_chart_node_holders_node",
            _HOLDERS,
            ["node_id", "sort_order"],
        )

    # Backfill, then drop. Guarded on the old columns still being present so a
    # re-run cannot duplicate every holder.
    if "user_id" in columns or "display_name" in columns:
        rows = bind.execute(
            sa.text(
                f"SELECT id, user_id, display_name FROM {_NODES} "
                "WHERE user_id IS NOT NULL OR display_name IS NOT NULL"
            )
        ).fetchall()
        for row in rows:
            bind.execute(
                sa.text(
                    f"INSERT INTO {_HOLDERS} "
                    "(id, node_id, user_id, display_name, sort_order) "
                    "VALUES (:id, :node, :user, :name, 0)"
                ),
                {
                    "id": str(uuid.uuid4()),
                    "node": row.id,
                    "user": row.user_id,
                    "name": row.display_name,
                },
            )

        if "user_id" in columns:
            _drop_fks_on(bind, inspector, _NODES, "user_id")
            op.drop_column(_NODES, "user_id")
        if "display_name" in columns:
            op.drop_column(_NODES, "display_name")


def downgrade() -> None:
    """Restore the single-holder shape, keeping each seat's first holder only.

    Lossy by construction; see the module docstring. The alternative — refusing
    to downgrade at all — would leave an operator rolling back a deploy with no
    way past this revision, which is worse than a documented, bounded loss.
    """
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    if _NODES not in inspector.get_table_names():
        return

    columns = _column_names(inspector, _NODES)

    if "user_id" not in columns:
        op.add_column(_NODES, sa.Column("user_id", sa.String(length=36), nullable=True))
        op.create_foreign_key(
            "fk_org_chart_nodes_user",
            _NODES,
            "users",
            ["user_id"],
            ["id"],
            ondelete="SET NULL",
        )
    if "display_name" not in columns:
        op.add_column(
            _NODES, sa.Column("display_name", sa.String(length=200), nullable=True)
        )

    if _HOLDERS in inspector.get_table_names():
        rows = bind.execute(
            sa.text(
                f"SELECT node_id, user_id, display_name FROM {_HOLDERS} "
                "ORDER BY node_id, sort_order, id"
            )
        ).fetchall()
        seen = set()
        for row in rows:
            if row.node_id in seen:
                continue
            seen.add(row.node_id)
            bind.execute(
                sa.text(
                    f"UPDATE {_NODES} SET user_id = :user, display_name = :name "
                    "WHERE id = :id"
                ),
                {
                    "user": row.user_id,
                    "name": row.display_name,
                    "id": row.node_id,
                },
            )
        # The table goes as one statement, taking its index with it. Dropping
        # the index first fails with MySQL 1553: (node_id, sort_order) is the
        # index the node_id foreign key is resolved through, so the server
        # refuses to leave the constraint without one.
        op.drop_table(_HOLDERS)

    if "position_id" in columns:
        _drop_fks_on(bind, inspector, _NODES, "position_id")
        op.drop_column(_NODES, "position_id")
    if "rank_code" in columns:
        op.drop_column(_NODES, "rank_code")
