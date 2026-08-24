"""Add org_chart_nodes and the orgchart.manage grant

Governance -> Organizational Chart. Publishes the department's real chain of
command — who is in charge of which area, and who they report to — to the
general membership.

Two parts:

1. The ``org_chart_nodes`` table. One row is one seat, curated by leadership
   rather than derived from positions: the application's permission tree and
   the department's real hierarchy genuinely disagree (the IT manager holds the
   wildcard grant and reports to the Chief in real life), so a generated chart
   would be one nobody in the department recognises.

2. A backfill of ``orgchart.manage`` onto existing positions. Positions are
   seeded from DEFAULT_POSITIONS at organization creation, so without this only
   organizations created after the deploy would get the grant and the screen
   would be read-only on every existing install except to a wildcard admin.

The grant rule is deliberately narrower than the one 06adc68a8b84 used for
``legal.propose``: it is earned by ``settings.manage``, not ``settings.view``.
``settings.view`` reaches down to company officers, and the published chain of
command is a statement about the department that a lieutenant should not be
able to rewrite. A department that wants its secretary maintaining the chart
grants the permission explicitly in the position editor, which is what a
separately-registered permission is for.

Revision ID: f2a91c7d6b04
Revises: b7d1e04f92a3
Create Date: 2026-08-24 23:30:00.000000

"""

import json
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "f2a91c7d6b04"
down_revision: Union[str, None] = "b7d1e04f92a3"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_MANAGE = "orgchart.manage"

# A position holding any of these already covers the new permission.
_COVERED_BY = ("*", "orgchart.*", _MANAGE)

# The existing grant that earns it.
_EARNED_BY = ("settings.manage", "settings.*")


def _load_permissions(raw):
    if isinstance(raw, str):
        raw = json.loads(raw or "[]")
    return list(raw or [])


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    if "org_chart_nodes" not in inspector.get_table_names():
        op.create_table(
            "org_chart_nodes",
            sa.Column("id", sa.String(length=36), nullable=False),
            sa.Column("organization_id", sa.String(length=36), nullable=False),
            # SET NULL columns must be nullable or MySQL rejects the FK with
            # error 1830 (pitfall #2). SET NULL rather than CASCADE so a delete
            # that reaches this column directly promotes the orphaned seats to
            # roots instead of silently erasing a whole branch of the chart.
            sa.Column("parent_id", sa.String(length=36), nullable=True),
            sa.Column("title", sa.String(length=150), nullable=False),
            sa.Column("responsibility", sa.Text(), nullable=True),
            sa.Column("user_id", sa.String(length=36), nullable=True),
            sa.Column("display_name", sa.String(length=200), nullable=True),
            sa.Column("contact_email", sa.String(length=320), nullable=True),
            sa.Column("contact_phone", sa.String(length=50), nullable=True),
            sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
            sa.Column(
                "is_published",
                sa.Boolean(),
                nullable=False,
                server_default=sa.true(),
            ),
            sa.Column(
                "created_at",
                sa.DateTime(timezone=True),
                server_default=sa.func.now(),
                nullable=False,
            ),
            sa.Column(
                "updated_at",
                sa.DateTime(timezone=True),
                server_default=sa.func.now(),
                nullable=False,
            ),
            sa.Column("updated_by", sa.String(length=36), nullable=True),
            sa.ForeignKeyConstraint(
                ["organization_id"], ["organizations.id"], ondelete="CASCADE"
            ),
            sa.ForeignKeyConstraint(
                ["parent_id"], ["org_chart_nodes.id"], ondelete="SET NULL"
            ),
            sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="SET NULL"),
            sa.ForeignKeyConstraint(["updated_by"], ["users.id"], ondelete="SET NULL"),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index(
            "ix_org_chart_nodes_org_parent",
            "org_chart_nodes",
            ["organization_id", "parent_id"],
        )

    # positions is materialized by startup create_all, which runs AFTER
    # migrations on a fresh install — nothing to backfill when it is absent,
    # and new organizations seed the grant from DEFAULT_POSITIONS anyway.
    if "positions" not in inspector.get_table_names():
        return

    rows = bind.execute(sa.text("SELECT id, permissions FROM positions")).fetchall()
    for row in rows:
        perms = _load_permissions(row.permissions)
        if any(covered in perms for covered in _COVERED_BY):
            continue
        if not any(earned in perms for earned in _EARNED_BY):
            continue
        perms.append(_MANAGE)
        bind.execute(
            sa.text("UPDATE positions SET permissions = :perms WHERE id = :id"),
            {"perms": json.dumps(perms), "id": row.id},
        )


def downgrade() -> None:
    # The table goes; the permission string stays.
    #
    # Dropping the table is safe and complete — it is new in this revision and
    # nothing else reads it, so no other screen loses data. It does discard the
    # chart a department built, which is the accepted cost of undoing the
    # feature that holds it.
    #
    # The grant is deliberately left in place, matching 06adc68a8b84: this
    # migration records nothing about which positions it touched, so an
    # orgchart.manage entry is indistinguishable from one an administrator
    # granted afterwards in the position editor. Revoking them all would
    # silently strip tenant-managed grants. The string is inert once the
    # endpoints are gone.
    bind = op.get_bind()
    if "org_chart_nodes" in sa.inspect(bind).get_table_names():
        op.drop_index("ix_org_chart_nodes_org_parent", table_name="org_chart_nodes")
        op.drop_table("org_chart_nodes")
