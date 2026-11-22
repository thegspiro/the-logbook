"""CRR catalogue tables: activity types, their counts, and risk/population tags.

Community risk reduction tracking, part 1 (owner decisions, 2026-11-21/22).
Four new tables; nothing existing is altered. The default catalogue is not
seeded here: it belongs to each department and is seeded the first time the
department's catalogue is read (``CrrCatalogueService.ensure_defaults``), which
reaches a department onboarded after this revision as well as one that exists
now.

Each table is created only if absent, so a database whose tables were already
built from the models by ``create_all`` upgrades cleanly (pitfall #26). The
downgrade drops the four tables and every catalogue row in them.

Revision ID: 89c0b481fe55
Revises: 561a3e9f4165
Create Date: 2026-11-22 14:28:00.000000
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "89c0b481fe55"
down_revision: Union[str, Sequence[str], None] = "561a3e9f4165"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# Child before parent, for the downgrade.
_TABLES = (
    "crr_activity_type_tags",
    "crr_activity_measures",
    "crr_tags",
    "crr_activity_types",
)


def _has_table(name: str) -> bool:
    return name in sa.inspect(op.get_bind()).get_table_names()


def _org_column() -> sa.Column:
    return sa.Column(
        "organization_id",
        sa.String(36),
        sa.ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
    )


def _flag(name: str, default: bool) -> sa.Column:
    return sa.Column(
        name,
        sa.Boolean(),
        nullable=False,
        server_default=sa.true() if default else sa.false(),
    )


def _sort_order() -> sa.Column:
    return sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0")


def _created_at() -> sa.Column:
    return sa.Column(
        "created_at",
        sa.DateTime(timezone=True),
        nullable=False,
        server_default=sa.func.now(),
    )


def upgrade() -> None:
    if not _has_table("crr_activity_types"):
        op.create_table(
            "crr_activity_types",
            sa.Column("id", sa.String(36), primary_key=True),
            _org_column(),
            sa.Column("code", sa.String(64), nullable=False),
            sa.Column("name", sa.String(120), nullable=False),
            sa.Column("description", sa.Text(), nullable=True),
            _flag("is_system", False),
            _flag("is_active", True),
            _sort_order(),
            _created_at(),
            sa.Column(
                "updated_at",
                sa.DateTime(timezone=True),
                nullable=False,
                server_default=sa.func.now(),
            ),
            sa.UniqueConstraint(
                "organization_id", "code", name="uq_crr_activity_types_code"
            ),
        )
        op.create_index(
            "ix_crr_activity_types_org",
            "crr_activity_types",
            ["organization_id", "is_active"],
        )

    if not _has_table("crr_tags"):
        op.create_table(
            "crr_tags",
            sa.Column("id", sa.String(36), primary_key=True),
            _org_column(),
            sa.Column("kind", sa.String(20), nullable=False),
            sa.Column("code", sa.String(64), nullable=False),
            sa.Column("label", sa.String(120), nullable=False),
            _flag("is_system", False),
            _flag("is_active", True),
            _sort_order(),
            _created_at(),
            sa.UniqueConstraint(
                "organization_id", "kind", "code", name="uq_crr_tags_code"
            ),
        )

    if not _has_table("crr_activity_measures"):
        op.create_table(
            "crr_activity_measures",
            sa.Column("id", sa.String(36), primary_key=True),
            _org_column(),
            sa.Column(
                "activity_type_id",
                sa.String(36),
                sa.ForeignKey("crr_activity_types.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column("code", sa.String(64), nullable=False),
            sa.Column("label", sa.String(120), nullable=False),
            _flag("is_active", True),
            _sort_order(),
            _created_at(),
            sa.UniqueConstraint(
                "activity_type_id", "code", name="uq_crr_activity_measures_code"
            ),
        )
        op.create_index(
            "ix_crr_activity_measures_org",
            "crr_activity_measures",
            ["organization_id"],
        )

    if not _has_table("crr_activity_type_tags"):
        op.create_table(
            "crr_activity_type_tags",
            sa.Column(
                "activity_type_id",
                sa.String(36),
                sa.ForeignKey("crr_activity_types.id", ondelete="CASCADE"),
                primary_key=True,
            ),
            sa.Column(
                "tag_id",
                sa.String(36),
                sa.ForeignKey("crr_tags.id", ondelete="CASCADE"),
                primary_key=True,
            ),
            _org_column(),
        )
        op.create_index(
            "ix_crr_activity_type_tags_tag", "crr_activity_type_tags", ["tag_id"]
        )
        op.create_index(
            "ix_crr_activity_type_tags_org",
            "crr_activity_type_tags",
            ["organization_id"],
        )


def downgrade() -> None:
    for table in _TABLES:
        op.execute(f"DROP TABLE IF EXISTS {table}")
