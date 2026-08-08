"""Complete the roles → positions rename the models already made

The models renamed the concept — ``Position`` / ``user_positions``, with
``Role = Position`` and ``user_roles = user_positions`` kept as compatibility
aliases — but no migration ever performed the rename. ``rename_table`` appears
exactly once in the whole chain, for ``meeting_action_items``.

That left three possible shapes in the wild, and this revision handles each:

1. **Only ``roles``** — a database built purely from the migration chain. The
   tables are renamed in place, so every position and every member's assignment
   is preserved.

2. **Both ``roles`` and ``positions``** — a chain-built database that has since
   started up against the current code. ``_attempt_schema_repair`` saw
   ``positions`` missing and created it *empty*; the real assignments are still
   sitting in ``roles``. If ``positions`` is empty and ``roles`` is not, the rows
   are copied across before the old tables are dropped. This is the data-loss
   recovery path: without it, a database in this state has no member holding any
   position, and therefore no permissions.

3. **Only ``positions``** — built by ``create_all()`` from current models. There
   is nothing to do.

``issuance_allowances.role_id`` keeps its column name (the model still calls it
that) but is repointed at ``positions``; ``20260805_0005`` deliberately skipped
it pending this revision.

Revision ID: 20260805_0008
Revises: 20260805_0007
Create Date: 2026-08-05 00:00:00.000000

"""

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "20260805_0008"
down_revision = "20260805_0007"
branch_labels = None
depends_on = None


def _count(bind, table) -> int:
    return bind.execute(sa.text(f"SELECT COUNT(*) FROM `{table}`")).scalar() or 0


def _drop_fks_to(bind, referenced) -> None:
    """Drop every foreign key pointing at ``referenced`` so it can be renamed."""
    rows = bind.execute(
        sa.text("""
            SELECT TABLE_NAME AS tbl, CONSTRAINT_NAME AS name
            FROM information_schema.KEY_COLUMN_USAGE
            WHERE TABLE_SCHEMA = DATABASE() AND REFERENCED_TABLE_NAME = :ref
            """),
        {"ref": referenced},
    ).fetchall()
    for row in rows:
        op.drop_constraint(row.name, row.tbl, type_="foreignkey")


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())

    has_roles = "roles" in tables
    has_positions = "positions" in tables

    if not has_roles:
        # Shape 3: nothing to migrate. Still make sure the allowance FK points
        # at positions, since a chain-built database that reached here through
        # shape 1 on an earlier run would already be correct.
        _repoint_issuance_allowances(bind)
        return

    if has_positions:
        # Shape 2: positions exists alongside roles. Recover the rows if the
        # repair pass created it empty, then drop the stale originals.
        if _count(bind, "positions") == 0 and _count(bind, "roles") > 0:
            op.execute(
                sa.text(
                    "INSERT INTO positions "
                    "(id, organization_id, name, slug, description, permissions, "
                    " is_system, priority, created_at, updated_at) "
                    "SELECT id, organization_id, name, slug, description, "
                    "       permissions, is_system, priority, created_at, updated_at "
                    "FROM roles"
                )
            )
            if "user_positions" in tables and _count(bind, "user_positions") == 0:
                op.execute(
                    sa.text(
                        "INSERT INTO user_positions "
                        "(user_id, position_id, assigned_at, assigned_by) "
                        "SELECT user_id, role_id, assigned_at, assigned_by "
                        "FROM user_roles"
                    )
                )

        _drop_fks_to(bind, "roles")
        if "user_roles" in tables:
            op.drop_table("user_roles")
        op.drop_table("roles")
        _repoint_issuance_allowances(bind)
        return

    # Shape 1: rename in place, preserving every row.
    _drop_fks_to(bind, "roles")
    op.rename_table("roles", "positions")
    if "user_roles" in tables:
        op.rename_table("user_roles", "user_positions")
        op.alter_column(
            "user_positions",
            "role_id",
            new_column_name="position_id",
            existing_type=sa.String(36),
            existing_nullable=False,
        )
        op.create_foreign_key(
            "fk_user_positions_position_id_positions",
            "user_positions",
            "positions",
            ["position_id"],
            ["id"],
            ondelete="CASCADE",
        )

    # positions.settings exists only in the model; the chain never added it.
    if "settings" not in {c["name"] for c in sa.inspect(bind).get_columns("positions")}:
        op.add_column("positions", sa.Column("settings", sa.JSON(), nullable=True))

    _repoint_issuance_allowances(bind)


def _repoint_issuance_allowances(bind) -> None:
    """Point issuance_allowances.role_id at positions rather than roles."""
    inspector = sa.inspect(bind)
    if not inspector.has_table("issuance_allowances"):
        return
    if not inspector.has_table("positions"):
        return

    canonical = "fk_issuance_allowances_role_id_positions"
    rows = bind.execute(sa.text("""
            SELECT k.CONSTRAINT_NAME AS name, k.REFERENCED_TABLE_NAME AS ref
            FROM information_schema.KEY_COLUMN_USAGE k
            WHERE k.TABLE_SCHEMA = DATABASE()
              AND k.TABLE_NAME = 'issuance_allowances'
              AND k.COLUMN_NAME = 'role_id'
              AND k.REFERENCED_TABLE_NAME IS NOT NULL
            """)).fetchall()

    if len(rows) == 1 and rows[0].name == canonical and rows[0].ref == "positions":
        return

    for row in rows:
        op.drop_constraint(row.name, "issuance_allowances", type_="foreignkey")

    op.create_foreign_key(
        canonical,
        "issuance_allowances",
        "positions",
        ["role_id"],
        ["id"],
        ondelete="CASCADE",
    )


def downgrade() -> None:
    # Renaming back would strand any position created since the upgrade, and
    # the compatibility aliases in the models mean nothing reads `roles`.
    pass
