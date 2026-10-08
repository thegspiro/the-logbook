"""Add fiscal_years.request_deadline and the budget_requests table.

Revision ID: 9effb8790488
Revises: 2be075025403
Create Date: 2026-10-08 20:16:44.501712

Next year's budget is built from requests: each line's owner (the holder of
its owner position, ``app/services/finance_budget_ownership.py``) proposes an
amount for a **draft** fiscal year, and the Treasurer approves it, adjusts it
with a note, or declines it (owner decisions, 2026-10-08). The Treasurer sets
a deadline per draft year; after it, owners can no longer add or change
requests.

* ``fiscal_years.request_deadline`` — a nullable ``DATE``. NULL (every
  existing row) means no deadline, so no installation changes behaviour on
  upgrade.
* ``budget_requests`` — one row per request. Every key that may outlive its
  row is ``ondelete="SET NULL"`` and therefore nullable (CLAUDE.md pitfall
  #2); the organization and the fiscal year cascade.

**Why each step is guarded.** ``fiscal_years``, ``budgets`` and
``budget_categories`` are built by ``create_all()`` and by no migration
(CLAUDE.md pitfall #26), and CI runs ``alembic upgrade head`` against an empty
database before anything calls ``create_all``. The column step therefore
needs the table, and the new table needs every table it keys to — MySQL
refuses a foreign key to a table that is not there. Skipping is correct rather
than merely safe: ``create_all`` builds ``fiscal_years`` with the column and
``budget_requests`` with its keys from the models, in the same pass that
builds the tables they reference. Each step is also guarded on its result
being absent, so a re-run changes nothing.

The key and index names match the models' naming convention, so a table
built by either path looks the same.

**Downgrade** drops the table and the column. The requests and the deadlines
are lost; amounts already approved stay in ``budgets.amount_budgeted``, which
is where the decision wrote them.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "9effb8790488"
down_revision: Union[str, None] = "2be075025403"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# Module-level so the migration test can aim it at scratch tables. Key and
# index names are spelled out rather than derived from the table names, so a
# prefixed scratch name cannot push one past MySQL's 64-character limit.
TABLE = "budget_requests"
FISCAL_YEARS = "fiscal_years"
BUDGETS = "budgets"
CATEGORIES = "budget_categories"
FACILITIES = "facilities"
POSITIONS = "positions"
ORGANIZATIONS = "organizations"
USERS = "users"
DEADLINE = "request_deadline"

FK_ORGANIZATION = "fk_budget_requests_organization_id_organizations"
FK_FISCAL_YEAR = "fk_budget_requests_fiscal_year_id_fiscal_years"
FK_BUDGET = "fk_budget_requests_budget_id_budgets"
FK_CATEGORY = "fk_budget_requests_category_id_budget_categories"
FK_STATION = "fk_budget_requests_station_id_facilities"
FK_OWNER_POSITION = "fk_budget_requests_owner_position_id_positions"
FK_SUBMITTED_BY = "fk_budget_requests_submitted_by_users"
FK_DECIDED_BY = "fk_budget_requests_decided_by_users"
IX_ORGANIZATION = "ix_budget_requests_organization_id"
IX_FISCAL_YEAR = "ix_budget_requests_fiscal_year_id"
IX_BUDGET = "ix_budget_requests_budget_id"
IX_OWNER_POSITION = "ix_budget_requests_owner_position_id"

STATUSES = ("draft", "submitted", "approved", "adjusted", "declined")


def _inspector():
    return sa.inspect(op.get_bind())


def _has_table(table: str) -> bool:
    return table in _inspector().get_table_names()


def _has_column(table: str, column: str) -> bool:
    return column in {c["name"] for c in _inspector().get_columns(table)}


def _upgrade_deadline() -> None:
    # No fiscal_years: create_all builds it later, column included.
    if _has_table(FISCAL_YEARS) and not _has_column(FISCAL_YEARS, DEADLINE):
        op.add_column(FISCAL_YEARS, sa.Column(DEADLINE, sa.Date(), nullable=True))


def _upgrade_requests() -> None:
    referenced = (
        FISCAL_YEARS,
        BUDGETS,
        CATEGORIES,
        FACILITIES,
        POSITIONS,
        ORGANIZATIONS,
        USERS,
    )
    # A referenced table missing: create_all builds them all, this one too.
    if _has_table(TABLE) or not all(_has_table(t) for t in referenced):
        return
    op.create_table(
        TABLE,
        sa.Column("id", sa.String(36), nullable=False),
        sa.Column("organization_id", sa.String(36), nullable=False),
        sa.Column("fiscal_year_id", sa.String(36), nullable=False),
        sa.Column("budget_id", sa.String(36), nullable=True),
        sa.Column("category_id", sa.String(36), nullable=True),
        sa.Column("station_id", sa.String(36), nullable=True),
        sa.Column("owner_position_id", sa.String(36), nullable=True),
        sa.Column("requested_amount", sa.Numeric(12, 2), nullable=False),
        sa.Column("justification", sa.Text(), nullable=False),
        sa.Column(
            "status",
            sa.Enum(*STATUSES, name="budgetrequeststatus"),
            nullable=False,
        ),
        sa.Column("approved_amount", sa.Numeric(12, 2), nullable=True),
        sa.Column("decision_note", sa.Text(), nullable=True),
        sa.Column("submitted_by", sa.String(36), nullable=True),
        sa.Column("submitted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("decided_by", sa.String(36), nullable=True),
        sa.Column("decided_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.PrimaryKeyConstraint("id", name="pk_budget_requests"),
        sa.ForeignKeyConstraint(
            ["organization_id"],
            [f"{ORGANIZATIONS}.id"],
            name=FK_ORGANIZATION,
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["fiscal_year_id"],
            [f"{FISCAL_YEARS}.id"],
            name=FK_FISCAL_YEAR,
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["budget_id"], [f"{BUDGETS}.id"], name=FK_BUDGET, ondelete="SET NULL"
        ),
        sa.ForeignKeyConstraint(
            ["category_id"],
            [f"{CATEGORIES}.id"],
            name=FK_CATEGORY,
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["station_id"],
            [f"{FACILITIES}.id"],
            name=FK_STATION,
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["owner_position_id"],
            [f"{POSITIONS}.id"],
            name=FK_OWNER_POSITION,
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["submitted_by"],
            [f"{USERS}.id"],
            name=FK_SUBMITTED_BY,
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["decided_by"],
            [f"{USERS}.id"],
            name=FK_DECIDED_BY,
            ondelete="SET NULL",
        ),
    )
    op.create_index(IX_ORGANIZATION, TABLE, ["organization_id"])
    op.create_index(IX_FISCAL_YEAR, TABLE, ["fiscal_year_id"])
    op.create_index(IX_BUDGET, TABLE, ["budget_id"])
    op.create_index(IX_OWNER_POSITION, TABLE, ["owner_position_id"])


def upgrade() -> None:
    _upgrade_deadline()
    _upgrade_requests()


def downgrade() -> None:
    op.execute(f"DROP TABLE IF EXISTS `{TABLE}`")
    if _has_table(FISCAL_YEARS) and _has_column(FISCAL_YEARS, DEADLINE):
        op.drop_column(FISCAL_YEARS, DEADLINE)
