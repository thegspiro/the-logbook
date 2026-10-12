"""Budget planning stages, the board's adoption record, and leadership review

Next year's budget now moves through stages before it is adopted: line owners
request amounts, the Treasurer closes the draft for senior leadership's
review, then it goes before the board, and activating it requires the board's
vote to be recorded.

* ``fiscal_years.planning_stage`` — ``requests``, ``leadership_review`` or
  ``board_review``; NULL for a year that is not a draft. Existing draft years
  are set to ``requests``, the stage they were in by behaviour, and the
  application also reads NULL on a draft as ``requests``.
* ``fiscal_years.adopted_on``, ``adoption_reference``, ``adoption_notes``,
  ``adoption_recorded_by`` (``SET NULL``), ``adoption_recorded_at`` — the
  board's adoption, recorded when a draft year is activated. Years activated
  before this revision keep NULLs: no vote was recorded for them, and none is
  invented.
* ``budget_requests.review_amount``, ``review_note``, ``reviewed_by``
  (``SET NULL``), ``reviewed_at`` — senior leadership's change to a decided
  amount, kept beside the Treasurer's decision.

``fiscal_years`` is built by ``create_all`` and by no migration, and
``budget_requests`` is created by ``9effb8790488`` only when every table it
references already exists, so each step is skipped when its table is absent;
``create_all`` then builds the table from the models, columns included.

The downgrade drops every column added here, losing recorded stages, board
adoption records and leadership reviews. The amounts leadership set stay in
the budget lines, which this revision does not touch.

Revision ID: 5c8be05f2f0f
Revises: c62a98b47406
Create Date: 2026-10-09 04:16:47.236151

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "5c8be05f2f0f"
down_revision: Union[str, None] = "c62a98b47406"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

FISCAL_YEARS = "fiscal_years"
REQUESTS = "budget_requests"
USERS = "users"

STAGES = ("requests", "leadership_review", "board_review")
FK_ADOPTION_RECORDED_BY = "fk_fiscal_years_adoption_recorded_by_users"
FK_REVIEWED_BY = "fk_budget_requests_reviewed_by_users"


def _inspector():
    return sa.inspect(op.get_bind())


def _has_table(table: str) -> bool:
    return table in _inspector().get_table_names()


def _has_column(table: str, column: str) -> bool:
    return column in {c["name"] for c in _inspector().get_columns(table)}


def _has_fk(table: str, name: str) -> bool:
    return name in {fk.get("name") for fk in _inspector().get_foreign_keys(table)}


def _add(table: str, column: sa.Column) -> None:
    if not _has_column(table, column.name):
        op.add_column(table, column)


def _upgrade_fiscal_years() -> None:
    if not _has_table(FISCAL_YEARS):
        return
    _add(
        FISCAL_YEARS,
        sa.Column(
            "planning_stage",
            sa.Enum(*STAGES, name="budgetplanningstage"),
            nullable=True,
        ),
    )
    _add(FISCAL_YEARS, sa.Column("adopted_on", sa.Date(), nullable=True))
    _add(FISCAL_YEARS, sa.Column("adoption_reference", sa.String(500), nullable=True))
    _add(FISCAL_YEARS, sa.Column("adoption_notes", sa.Text(), nullable=True))
    _add(FISCAL_YEARS, sa.Column("adoption_recorded_by", sa.String(36), nullable=True))
    _add(
        FISCAL_YEARS,
        sa.Column("adoption_recorded_at", sa.DateTime(timezone=True), nullable=True),
    )
    if _has_table(USERS) and not _has_fk(FISCAL_YEARS, FK_ADOPTION_RECORDED_BY):
        op.create_foreign_key(
            FK_ADOPTION_RECORDED_BY,
            FISCAL_YEARS,
            USERS,
            ["adoption_recorded_by"],
            ["id"],
            ondelete="SET NULL",
        )
    op.execute(
        sa.text(
            "UPDATE fiscal_years SET planning_stage = 'requests' "
            "WHERE status = 'draft' AND planning_stage IS NULL"
        )
    )


def _upgrade_requests() -> None:
    if not _has_table(REQUESTS):
        return
    _add(REQUESTS, sa.Column("review_amount", sa.Numeric(12, 2), nullable=True))
    _add(REQUESTS, sa.Column("review_note", sa.Text(), nullable=True))
    _add(REQUESTS, sa.Column("reviewed_by", sa.String(36), nullable=True))
    _add(
        REQUESTS,
        sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True),
    )
    if _has_table(USERS) and not _has_fk(REQUESTS, FK_REVIEWED_BY):
        op.create_foreign_key(
            FK_REVIEWED_BY,
            REQUESTS,
            USERS,
            ["reviewed_by"],
            ["id"],
            ondelete="SET NULL",
        )


def upgrade() -> None:
    _upgrade_fiscal_years()
    _upgrade_requests()


def _drop(table: str, columns: tuple[str, ...], fk: str) -> None:
    if not _has_table(table):
        return
    if _has_fk(table, fk):
        op.drop_constraint(fk, table, type_="foreignkey")
    for column in columns:
        if _has_column(table, column):
            op.drop_column(table, column)


def downgrade() -> None:
    _drop(
        REQUESTS,
        ("review_amount", "review_note", "reviewed_by", "reviewed_at"),
        FK_REVIEWED_BY,
    )
    _drop(
        FISCAL_YEARS,
        (
            "planning_stage",
            "adopted_on",
            "adoption_reference",
            "adoption_notes",
            "adoption_recorded_by",
            "adoption_recorded_at",
        ),
        FK_ADOPTION_RECORDED_BY,
    )
