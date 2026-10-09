"""Fiscal year adoption stage, year-end close, and the lock sign-off

Adopting next year's budget and starting the year are now separate steps, and
the year-end close is a period the Treasurer begins rather than a side effect
of starting the next year.

* ``fiscal_years.planning_stage`` gains ``adopted``: the board's vote is
  recorded and the draft waits for the Treasurer to start it on or after its
  start date. No existing row is moved into it.
* ``fiscal_years.closing_started_at`` — when the year-end close began. A year
  closed before this revision without being locked (the year a newer one
  replaced) keeps NULL here and reads as being in its closing period; no date
  is invented for it.
* ``fiscal_years.locked_by`` (``SET NULL``), ``locked_at``, ``lock_notes`` —
  the Treasurer's reconciliation sign-off. Years locked before this revision
  keep NULLs: nobody signed them off, and nobody is named.

``fiscal_years`` is built by ``create_all`` and by no migration, so each step
is skipped when the table is absent; ``create_all`` then builds it from the
models, columns included.

The downgrade drops the columns, losing close dates and sign-offs, and
returns any ``adopted`` draft to ``board_review`` before narrowing the enum —
its adoption record (from ``5c8be05f2f0f``) stays, but under the previous
revision's rules the draft would then be adopted again by activating it.

Revision ID: af92f1496c43
Revises: 5c8be05f2f0f
Create Date: 2026-10-09 05:42:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "af92f1496c43"
down_revision: Union[str, None] = "5c8be05f2f0f"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

FISCAL_YEARS = "fiscal_years"
USERS = "users"

OLD_STAGES = ("requests", "leadership_review", "board_review")
NEW_STAGES = OLD_STAGES + ("adopted",)
FK_LOCKED_BY = "fk_fiscal_years_locked_by_users"
NEW_COLUMNS = ("closing_started_at", "locked_by", "locked_at", "lock_notes")


def _inspector():
    return sa.inspect(op.get_bind())


def _has_table(table: str) -> bool:
    return table in _inspector().get_table_names()


def _columns(table: str) -> dict:
    return {c["name"]: c for c in _inspector().get_columns(table)}


def _has_fk(table: str, name: str) -> bool:
    return name in {fk.get("name") for fk in _inspector().get_foreign_keys(table)}


def _stage_values() -> tuple[str, ...]:
    column = _columns(FISCAL_YEARS).get("planning_stage")
    if column is None:
        return ()
    return tuple(getattr(column["type"], "enums", ()) or ())


def _set_stages(old: tuple[str, ...], new: tuple[str, ...]) -> None:
    op.alter_column(
        FISCAL_YEARS,
        "planning_stage",
        existing_type=sa.Enum(*old, name="budgetplanningstage"),
        type_=sa.Enum(*new, name="budgetplanningstage"),
        existing_nullable=True,
    )


def upgrade() -> None:
    if not _has_table(FISCAL_YEARS):
        return
    stages = _stage_values()
    if stages and "adopted" not in stages:
        _set_stages(stages, NEW_STAGES)
    existing = _columns(FISCAL_YEARS)
    added = (
        sa.Column("closing_started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("locked_by", sa.String(36), nullable=True),
        sa.Column("locked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("lock_notes", sa.Text(), nullable=True),
    )
    for column in added:
        if column.name not in existing:
            op.add_column(FISCAL_YEARS, column)
    if _has_table(USERS) and not _has_fk(FISCAL_YEARS, FK_LOCKED_BY):
        op.create_foreign_key(
            FK_LOCKED_BY,
            FISCAL_YEARS,
            USERS,
            ["locked_by"],
            ["id"],
            ondelete="SET NULL",
        )


def downgrade() -> None:
    if not _has_table(FISCAL_YEARS):
        return
    if _has_fk(FISCAL_YEARS, FK_LOCKED_BY):
        op.drop_constraint(FK_LOCKED_BY, FISCAL_YEARS, type_="foreignkey")
    existing = _columns(FISCAL_YEARS)
    for name in NEW_COLUMNS:
        if name in existing:
            op.drop_column(FISCAL_YEARS, name)
    if "adopted" in _stage_values():
        op.execute(
            sa.text(
                "UPDATE fiscal_years SET planning_stage = 'board_review' "
                "WHERE planning_stage = 'adopted'"
            )
        )
        _set_stages(NEW_STAGES, OLD_STAGES)
