"""Add budget_amendments: logged increases to a budget line.

Revision ID: ca564ba5a9ad
Revises: d429a803f847
Create Date: 2026-10-08 15:18:00.000000

When leadership approves extra money for a budget line, the Treasurer records
it as an **amendment** (owner decision, 2026-10-08): the amount added, the
reason, who approved it and on what date, and who entered it. Adding one
raises ``budgets.amount_budgeted`` in the same transaction, so that column
stays the live ceiling; the original budget is computed, never stored.

**Why the table is skipped when ``budgets`` does not exist.** ``budgets`` is
built by ``create_all()`` and by no migration (CLAUDE.md pitfall #26), and
CI runs ``alembic upgrade head`` against an empty database before anything
calls ``create_all``. This table carries a foreign key to ``budgets``, and
MySQL refuses a foreign key to a table that is not there — so on such a
database it cannot be created here. Skipping is correct rather than merely
safe: ``create_all`` builds ``budget_amendments`` from the model, with its
keys, in the same pass that builds ``budgets``. Where ``budgets`` exists (every
installation that has started the app) the table is created here, unless it
already exists, so a re-run changes nothing.

The key and index names match the models' naming convention, so a table
built by either path looks the same.

**Downgrade** drops the table. The amendment records are lost; the amounts
they added stay in ``budgets.amount_budgeted``, which is where the spend
checks have always read them from.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "ca564ba5a9ad"
down_revision: Union[str, None] = "d429a803f847"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# Module-level so the migration test can aim it at scratch tables. The key and
# index names are spelled out rather than derived from the table names, so a
# prefixed scratch name cannot push one past MySQL's 64-character limit.
TABLE = "budget_amendments"
BUDGETS = "budgets"
ORGANIZATIONS = "organizations"
USERS = "users"
FK_ORGANIZATION = "fk_budget_amendments_organization_id_organizations"
FK_BUDGET = "fk_budget_amendments_budget_id_budgets"
FK_CREATED_BY = "fk_budget_amendments_created_by_users"
IX_ORGANIZATION = "ix_budget_amendments_organization_id"
IX_BUDGET = "ix_budget_amendments_budget_id"


def _has_table(table: str) -> bool:
    return table in sa.inspect(op.get_bind()).get_table_names()


def upgrade() -> None:
    # No budgets table: create_all builds both later, from the models.
    if not _has_table(BUDGETS) or _has_table(TABLE):
        return
    op.create_table(
        TABLE,
        sa.Column("id", sa.String(36), nullable=False),
        sa.Column("organization_id", sa.String(36), nullable=False),
        sa.Column("budget_id", sa.String(36), nullable=False),
        sa.Column("amount", sa.Numeric(12, 2), nullable=False),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column("approved_by", sa.String(200), nullable=False),
        sa.Column("approved_on", sa.Date(), nullable=False),
        sa.Column("created_by", sa.String(36), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.PrimaryKeyConstraint("id", name="pk_budget_amendments"),
        sa.ForeignKeyConstraint(
            ["organization_id"],
            [f"{ORGANIZATIONS}.id"],
            name=FK_ORGANIZATION,
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["budget_id"],
            [f"{BUDGETS}.id"],
            name=FK_BUDGET,
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["created_by"],
            [f"{USERS}.id"],
            name=FK_CREATED_BY,
            ondelete="SET NULL",
        ),
    )
    op.create_index(IX_ORGANIZATION, TABLE, ["organization_id"])
    op.create_index(IX_BUDGET, TABLE, ["budget_id"])


def downgrade() -> None:
    op.execute(f"DROP TABLE IF EXISTS `{TABLE}`")
