"""Member position terms: a dated history of positions held

Revision ID: 67ad01c43434
Revises: e4c6e82acbc2
Create Date: 2026-11-06 23:23:03.290976

Adds ``member_position_terms`` (owner decision 2026-11-06): one row per
stretch of time a member held an office or committee seat, written whenever a
``user_positions`` row is added or removed. See
``app/models/member_position_term.py`` for the column choices.

**Existing rows are settled here (CLAUDE.md pitfall #35).** Every
``user_positions`` row an installation already has gets one open term, so a
member's current positions have a history from the day this runs:

- ``started_at`` is the row's ``assigned_at``. Where that is NULL (a row
  written by hand without the server default) it falls back to the member's
  ``created_at``, and failing that to the time of the upgrade -- the earliest
  date the database can vouch for, never an invented one.
- ``assigned_by`` is copied from the row.
- Nothing earlier is reconstructed. A position given up before this revision
  ran left no row, and the audit log's ``user_role_assigned`` /
  ``user_role_removed`` events are not replayed into history: rebuilding from
  them depends on the log being complete, which the owner declined to rely on.

The seed skips any pair that already has an open term, so a re-run (or a
database whose table ``create_all`` built, at head, before the app wrote any
terms) opens nothing twice. The table is created only when absent.

The downgrade drops the table and every recorded term with it. Nothing else in
the schema refers to it and ``user_positions`` is untouched, so the previous
release boots against the downgraded database; the history itself is lost, so
take a backup (``scripts/backup.sh``) before downgrading past this revision.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "67ad01c43434"
down_revision: Union[str, None] = "e4c6e82acbc2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# Module-level so the migration test can aim it at scratch tables. Key and
# index names are spelled out so a prefixed scratch name cannot push a derived
# one past MySQL's 64-character limit.
TABLE = "member_position_terms"
USERS = "users"
POSITIONS = "positions"
ORGANIZATIONS = "organizations"
USER_POSITIONS = "user_positions"
UQ_OPEN = "uq_member_position_terms_open"
# The naming convention alembic runs under expands this to
# ck_member_position_terms_date_order, as create_all does for the model.
CK_DATE_ORDER = "date_order"
FK_ORGANIZATION = "fk_member_position_terms_organization_id_organizations"
FK_USER = "fk_member_position_terms_user_id_users"
FK_POSITION = "fk_member_position_terms_position_id_positions"
FK_ASSIGNED_BY = "fk_member_position_terms_assigned_by_users"
FK_ENDED_BY = "fk_member_position_terms_ended_by_users"
IX_ORG_USER = "ix_member_position_terms_org_user"
IX_POSITION = "ix_member_position_terms_position"

# Inlined rather than imported from the model: a migration must keep doing
# what it did the day it ran, and the model's constant is free to change.
_OPEN_MARKER_EXPRESSION = "CASE WHEN ended_at IS NULL THEN 1 ELSE NULL END"


def _tables() -> set[str]:
    return set(sa.inspect(op.get_bind()).get_table_names())


def upgrade() -> None:
    tables = _tables()
    if not {USERS, POSITIONS, ORGANIZATIONS, USER_POSITIONS} <= tables:
        # Nothing to refer to yet: create_all builds the table from the model.
        return
    if TABLE not in tables:
        op.create_table(
            TABLE,
            sa.Column("id", sa.String(36), nullable=False),
            sa.Column("organization_id", sa.String(36), nullable=False),
            sa.Column("user_id", sa.String(36), nullable=False),
            sa.Column("position_id", sa.String(36), nullable=True),
            sa.Column("position_name", sa.String(100), nullable=False),
            sa.Column("position_kind", sa.String(20), nullable=True),
            sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("ended_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column(
                "open_marker",
                sa.Integer(),
                sa.Computed(_OPEN_MARKER_EXPRESSION, persisted=True),
            ),
            sa.Column("assigned_by", sa.String(36), nullable=True),
            sa.Column("ended_by", sa.String(36), nullable=True),
            sa.PrimaryKeyConstraint("id", name=f"pk_{TABLE}"),
            sa.ForeignKeyConstraint(
                ["organization_id"],
                [f"{ORGANIZATIONS}.id"],
                name=FK_ORGANIZATION,
                ondelete="CASCADE",
            ),
            sa.ForeignKeyConstraint(
                ["user_id"], [f"{USERS}.id"], name=FK_USER, ondelete="CASCADE"
            ),
            sa.ForeignKeyConstraint(
                ["position_id"],
                [f"{POSITIONS}.id"],
                name=FK_POSITION,
                ondelete="SET NULL",
            ),
            sa.ForeignKeyConstraint(
                ["assigned_by"],
                [f"{USERS}.id"],
                name=FK_ASSIGNED_BY,
                ondelete="SET NULL",
            ),
            sa.ForeignKeyConstraint(
                ["ended_by"], [f"{USERS}.id"], name=FK_ENDED_BY, ondelete="SET NULL"
            ),
            sa.UniqueConstraint("user_id", "position_id", "open_marker", name=UQ_OPEN),
            sa.CheckConstraint(
                "ended_at IS NULL OR ended_at >= started_at", name=CK_DATE_ORDER
            ),
        )
        op.create_index(
            IX_ORG_USER, TABLE, ["organization_id", "user_id", "started_at"]
        )
        op.create_index(IX_POSITION, TABLE, ["position_id"])

    # One open term per position held today. UUID() is evaluated per row.
    op.execute(f"""
        INSERT INTO {TABLE}
            (id, organization_id, user_id, position_id, position_name,
             position_kind, started_at, assigned_by)
        SELECT UUID(), u.organization_id, up.user_id, up.position_id, p.name,
               p.kind, COALESCE(up.assigned_at, u.created_at, CURRENT_TIMESTAMP),
               up.assigned_by
        FROM {USER_POSITIONS} up
        JOIN {USERS} u ON u.id = up.user_id
        JOIN {POSITIONS} p ON p.id = up.position_id
        WHERE NOT EXISTS (
            SELECT 1 FROM {TABLE} t
            WHERE t.user_id = up.user_id
              AND t.position_id = up.position_id
              AND t.ended_at IS NULL
        )
        """)


def downgrade() -> None:
    op.execute(f"DROP TABLE IF EXISTS `{TABLE}`")
