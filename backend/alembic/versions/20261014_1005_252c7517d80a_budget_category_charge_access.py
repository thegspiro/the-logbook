"""Let a budget category restrict who may charge its lines.

Revision ID: 252c7517d80a
Revises: a39a1999776f
Create Date: 2026-10-14 10:05:14.682136

Budget categories already nest (``parent_category_id``); a Quartermaster
category can hold sub-lines such as boot reimbursement and officer brass.
This adds who may charge each one (owner decisions, 2026-10-14):

* ``budget_categories.charge_access`` — a nullable ``ENUM('open',
  'restricted')``. NULL inherits the parent's, and a top-level NULL is open,
  so every existing category (all NULL) behaves exactly as before.
* ``budget_category_charge_positions`` — the positions a restricted category
  names as able to charge it, beyond those answerable for it. Both keys
  cascade: the row means nothing once its category or position is gone.

**Why each step is guarded.** ``budget_categories`` is built by
``create_all()`` and by no migration (CLAUDE.md pitfall #26), and CI runs
``alembic upgrade head`` against an empty database before anything calls
``create_all``. The column needs the table, and the new table needs every
table it keys to. Skipping is correct rather than merely safe: ``create_all``
builds both from the models. Each step is also guarded on its result being
absent, so a re-run changes nothing.

**Downgrade** drops the table and the column. Every restriction and named
position is lost and every line is open to requesters again, which is how
they behaved before this revision.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "252c7517d80a"
down_revision: Union[str, None] = "a39a1999776f"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# Module-level so the migration test can aim it at scratch tables. Key and
# index names are spelled out exactly as create_all gives the models — two are
# past MySQL's 64-character limit untruncated, so SQLAlchemy shortens them
# with a hash suffix, and the migration must produce the same names.
TABLE = "budget_category_charge_positions"
CATEGORIES = "budget_categories"
POSITIONS = "positions"
ORGANIZATIONS = "organizations"
COLUMN = "charge_access"
VALUES = ("open", "restricted")

FK_ORGANIZATION = "fk_budget_category_charge_positions_organization_id_orga_18a0"
FK_CATEGORY = "fk_budget_category_charge_positions_category_id_budget_c_9562"
FK_POSITION = "fk_budget_category_charge_positions_position_id_positions"
UQ_CATEGORY_POSITION = "uq_budget_category_charge_positions_category_position"
IX_ORGANIZATION = "ix_budget_category_charge_positions_organization_id"
IX_POSITION = "ix_budget_category_charge_positions_position_id"


def _inspector():
    return sa.inspect(op.get_bind())


def _has_table(table: str) -> bool:
    return table in _inspector().get_table_names()


def _has_column(table: str, column: str) -> bool:
    return column in {c["name"] for c in _inspector().get_columns(table)}


def _upgrade_column() -> None:
    if _has_table(CATEGORIES) and not _has_column(CATEGORIES, COLUMN):
        op.add_column(
            CATEGORIES,
            sa.Column(COLUMN, sa.Enum(*VALUES, name="chargeaccess"), nullable=True),
        )


def _upgrade_positions() -> None:
    referenced = (CATEGORIES, POSITIONS, ORGANIZATIONS)
    if _has_table(TABLE) or not all(_has_table(t) for t in referenced):
        return
    op.create_table(
        TABLE,
        sa.Column("id", sa.String(36), nullable=False),
        sa.Column("organization_id", sa.String(36), nullable=False),
        sa.Column("category_id", sa.String(36), nullable=False),
        sa.Column("position_id", sa.String(36), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.PrimaryKeyConstraint("id", name=f"pk_{TABLE}"),
        sa.ForeignKeyConstraint(
            ["organization_id"],
            [f"{ORGANIZATIONS}.id"],
            name=FK_ORGANIZATION,
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["category_id"],
            [f"{CATEGORIES}.id"],
            name=FK_CATEGORY,
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["position_id"],
            [f"{POSITIONS}.id"],
            name=FK_POSITION,
            ondelete="CASCADE",
        ),
        sa.UniqueConstraint("category_id", "position_id", name=UQ_CATEGORY_POSITION),
    )
    op.create_index(IX_ORGANIZATION, TABLE, ["organization_id"])
    op.create_index(IX_POSITION, TABLE, ["position_id"])


def upgrade() -> None:
    _upgrade_column()
    _upgrade_positions()


def downgrade() -> None:
    op.execute(f"DROP TABLE IF EXISTS `{TABLE}`")
    if _has_table(CATEGORIES) and _has_column(CATEGORIES, COLUMN):
        op.drop_column(CATEGORIES, COLUMN)
