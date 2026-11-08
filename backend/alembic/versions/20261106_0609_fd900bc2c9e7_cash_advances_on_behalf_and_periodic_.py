"""Cash advances raised on a member's behalf, and periodic statements

Owner decisions, 2026-11-01:

* ``check_requests.raised_by`` (nullable, ``SET NULL`` to ``users``) — the
  finance officer who raised an advance for the member named in
  ``requested_by``. Null for every existing row: until now a member could
  raise an advance only for themselves.
* ``check_requests.advance_return_method`` (nullable) — the IRS method an
  advance's return deadline follows, fixed when its check is issued. Null for
  every existing row, which reads as the fixed-date method, the only one
  there was: no deadline already running moves.
* ``advance_statements`` — the quarterly statements emailed to the holder of
  an advance on the periodic-statement method, one per advance and quarter
  (unique), so a second run of the scheduled task sends nothing.

Nothing is backfilled and no constraint is tightened on existing rows: both
columns are nullable, and the new table starts empty. ``check_requests`` may
be built by ``create_all`` rather than a migration, so each step is skipped
when it is absent; the new table is created only when ``check_requests``
exists, since its key points there.

The downgrade drops the table and the columns. Who raised an advance on a
member's behalf and which advances follow the periodic method are lost with
them; every advance then reads as the member's own and as fixed-date.

Revision ID: fd900bc2c9e7
Revises: 5f3bc23bc9a6
Create Date: 2026-11-06 06:09:47.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "fd900bc2c9e7"
down_revision: Union[str, None] = "5f3bc23bc9a6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

CHECKS = "check_requests"
STATEMENTS = "advance_statements"
# The name the models' naming convention gives this key, so the downgrade
# finds it however the table was built.
RAISED_BY_FK = "fk_check_requests_raised_by_users"


def _inspector():
    return sa.inspect(op.get_bind())


def _has_table(table: str) -> bool:
    return table in _inspector().get_table_names()


def _columns(table: str) -> set[str]:
    return {c["name"] for c in _inspector().get_columns(table)}


def _has_fk(table: str, name: str) -> bool:
    return name in {fk.get("name") for fk in _inspector().get_foreign_keys(table)}


def upgrade() -> None:
    if not _has_table(CHECKS):
        return
    existing = _columns(CHECKS)
    if "raised_by" not in existing:
        op.add_column(CHECKS, sa.Column("raised_by", sa.String(36), nullable=True))
    if not _has_fk(CHECKS, RAISED_BY_FK):
        op.create_foreign_key(
            RAISED_BY_FK, CHECKS, "users", ["raised_by"], ["id"], ondelete="SET NULL"
        )
    if "advance_return_method" not in existing:
        op.add_column(
            CHECKS,
            sa.Column("advance_return_method", sa.String(20), nullable=True),
        )

    if not _has_table(STATEMENTS):
        op.create_table(
            STATEMENTS,
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column(
                "organization_id",
                sa.String(36),
                sa.ForeignKey("organizations.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column(
                "advance_id",
                sa.String(36),
                sa.ForeignKey(f"{CHECKS}.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column("statement_date", sa.Date(), nullable=False),
            sa.Column("due_date", sa.Date(), nullable=False),
            sa.Column("outstanding", sa.Numeric(12, 2), nullable=False),
            sa.Column("emailed_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column(
                "created_at",
                sa.DateTime(timezone=True),
                nullable=False,
                server_default=sa.func.now(),
            ),
            sa.UniqueConstraint(
                "advance_id", "statement_date", name="uq_advance_statement_quarter"
            ),
            sa.Index("ix_advance_statements_org", "organization_id"),
            mysql_charset="utf8mb4",
            mysql_collate="utf8mb4_unicode_ci",
        )


def downgrade() -> None:
    op.execute(f"DROP TABLE IF EXISTS {STATEMENTS}")
    if not _has_table(CHECKS):
        return
    if _has_fk(CHECKS, RAISED_BY_FK):
        op.drop_constraint(RAISED_BY_FK, CHECKS, type_="foreignkey")
    existing = _columns(CHECKS)
    if "raised_by" in existing:
        op.drop_column(CHECKS, "raised_by")
    if "advance_return_method" in existing:
        op.drop_column(CHECKS, "advance_return_method")
