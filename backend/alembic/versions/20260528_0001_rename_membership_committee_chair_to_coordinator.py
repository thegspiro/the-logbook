"""rename the "Membership Committee Chair" system position to "Membership Coordinator"

The role is being renamed to match the terminology used throughout the rest of
the application (interviewer roles, pipeline approver configs, and admin error
messages all already say "Membership Coordinator"). The permission set is
unchanged, so it keeps ``prospective_members.manage`` (view/upload/delete of
prospect documents).

This is an in-place rename of the existing position rows. The membership link
is by position id (a UUID that does not change), so every existing assignment
is preserved automatically.

Revision ID: 20260528_0001
Revises: 20260502_0004
Create Date: 2026-05-28 00:00:00.000000

"""

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "20260528_0001"
down_revision = "20260502_0004"
branch_labels = None
depends_on = None


def _positions_table(bind) -> str | None:
    """The table holding position rows at this point in the chain.

    This revision is an ancestor of ``20260805_0008``, which renames ``roles``
    to ``positions``. Until that revision runs the rows live in ``roles``. The
    models were renamed long before the database was, which is why this
    migration was originally written against ``positions`` and then silently
    no-opped on every upgrade path it was supposed to repair.

    A database that has also been started against current code carries an empty
    ``positions`` beside a populated ``roles`` -- the shape ``20260805_0008``
    calls "shape 2" -- so ``roles`` is preferred whenever it is present.
    """
    tables = set(sa.inspect(bind).get_table_names())
    if "roles" in tables:
        return "roles"
    if "positions" in tables:
        return "positions"
    return None


def _rename(bind, table: str, old_slug: str, new_slug: str, new_name: str) -> None:
    """Rename *old_slug* to *new_slug*, skipping orgs that already hold it.

    ``idx_role_org_slug`` is UNIQUE on ``(organization_id, slug)``, so an
    organization that already has a row under *new_slug* would make a blind
    UPDATE raise and take the whole upgrade down with it.
    """
    taken = {
        row.organization_id
        for row in bind.execute(
            sa.text(
                f"SELECT organization_id FROM `{table}` WHERE slug = :slug"  # noqa: S608
            ),
            {"slug": new_slug},
        )
    }
    rows = bind.execute(
        sa.text(
            f"SELECT id, organization_id FROM `{table}` WHERE slug = :slug"  # noqa: S608
        ),
        {"slug": old_slug},
    ).fetchall()
    for row in rows:
        if row.organization_id in taken:
            continue
        bind.execute(
            sa.text(
                f"UPDATE `{table}` SET slug = :slug, name = :name "  # noqa: S608
                "WHERE id = :id"
            ),
            {"slug": new_slug, "name": new_name, "id": row.id},
        )


def upgrade() -> None:
    bind = op.get_bind()
    table = _positions_table(bind)
    if table is None:
        return

    _rename(
        bind,
        table,
        "membership_committee_chair",
        "membership_coordinator",
        "Membership Coordinator",
    )


def downgrade() -> None:
    bind = op.get_bind()
    table = _positions_table(bind)
    if table is None:
        return

    _rename(
        bind,
        table,
        "membership_coordinator",
        "membership_committee_chair",
        "Membership Committee Chair",
    )
