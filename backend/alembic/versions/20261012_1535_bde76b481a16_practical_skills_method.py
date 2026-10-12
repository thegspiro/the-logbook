"""Add the department's practical-skills method to training settings

Two systems record practical skills: Skills Testing (station sheets, scored by
an examiner and validated by an officer) and shift-report sign-offs (skills a
shift officer ticks as demonstrated, which raise the member's competency). A
department now runs one of them, chosen in Training settings, and the other's
screens are hidden.

``training_module_configs.practical_skills_method`` holds the choice. NULL
means "never chosen" and reads as ``skills_testing``.

The backfill picks ``shift_signoffs`` for a department that already uses
sign-offs and has never run a skills test, so nothing it relies on disappears
on upgrade. Every other department keeps NULL, which is Skills Testing. Only
existing config rows are updated: a department with sign-offs always has one,
because filing a shift report reads its config and creates the row.

``skill_tests`` is built by ``create_all`` on some deployments and by no
migration, so it is checked for before it is read; when it is absent no
department has run a test.

Downgrade drops the column. The choice is lost, which is all the column holds.

Revision ID: bde76b481a16
Revises: 3c9c5025a380
Create Date: 2026-10-12 15:35:15

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "bde76b481a16"
down_revision: Union[str, None] = "3c9c5025a380"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

TABLE = "training_module_configs"
COLUMN = "practical_skills_method"


def _has_table(inspector, table: str) -> bool:
    return inspector.has_table(table)


def _has_column(inspector, table: str, column: str) -> bool:
    return column in {c["name"] for c in inspector.get_columns(table)}


def backfill_statement(*, has_skill_tests: bool) -> str:
    """Sign-offs for a department that uses them and has never run a test.

    Only rows nobody has chosen for yet, so a re-run never overwrites a
    department's own decision. A function so the test suite can run the same
    statement against real tables.
    """
    statement = (
        f"UPDATE {TABLE} SET {COLUMN} = 'shift_signoffs' "
        f"WHERE {COLUMN} IS NULL "
        "AND organization_id IN (SELECT organization_id FROM skill_checkoffs)"
    )
    if has_skill_tests:
        statement += (
            " AND organization_id NOT IN (SELECT organization_id FROM skill_tests)"
        )
    return statement


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if not _has_table(inspector, TABLE):
        return

    if not _has_column(inspector, TABLE, COLUMN):
        op.add_column(TABLE, sa.Column(COLUMN, sa.String(30), nullable=True))

    if not _has_table(inspector, "skill_checkoffs"):
        return
    bind.execute(
        sa.text(
            backfill_statement(has_skill_tests=_has_table(inspector, "skill_tests"))
        )
    )


def downgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    if _has_table(inspector, TABLE) and _has_column(inspector, TABLE, COLUMN):
        op.drop_column(TABLE, COLUMN)
