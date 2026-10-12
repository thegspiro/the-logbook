"""Expense reports record when they were submitted, and which lines were late

Under an accountable plan, an expense must be substantiated within a
reasonable time of being incurred; the IRS safe harbor is 60 days. A
department can now set a substantiation rule (organization settings,
``finance.substantiation_mode`` and ``finance.substantiation_days``), and an
expense report records what it was graded against:

* ``expense_reports.submitted_at`` — when the member submitted it.
* ``expense_line_items.substantiated_late`` — the line was submitted more than
  the department's deadline after it was incurred. Decided once, at
  submission.
* ``expense_reports.late_acknowledged_by`` (``SET NULL`` to ``users``) and
  ``late_acknowledged_at`` — under the "warn" rule, the approver who confirmed
  reviewing the late lines.

Nothing is backfilled. When an existing report was submitted was never
recorded, so its lines cannot be graded; the rule is off until a department
sets it, and applies to reports submitted after that. Any of these tables may
be built by ``create_all`` rather than a migration, so each step is skipped
when its table is absent; ``create_all`` then builds it from the model,
columns included.

This revision also joins the two heads ``a51a4e1d2443`` and ``bde76b481a16``,
which were published with the same parent and left the chain with two heads.

The downgrade drops the columns. Which lines were late, and who acknowledged
them, are lost with them; a report held for that acknowledgement stays waiting
for approval, and the previous revision's code lets any approver approve it.

Revision ID: afaca8c1f812
Revises: a51a4e1d2443, bde76b481a16
Create Date: 2026-10-12 22:04:36.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "afaca8c1f812"
down_revision: Union[str, Sequence[str], None] = ("a51a4e1d2443", "bde76b481a16")
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

USERS = "users"
REPORTS = "expense_reports"
LINES = "expense_line_items"
# The name the models' naming convention gives this key, so the downgrade
# finds it however the table was built.
ACK_FK = "fk_expense_reports_late_acknowledged_by_users"
REPORT_COLUMNS = ("submitted_at", "late_acknowledged_by", "late_acknowledged_at")


def _inspector():
    return sa.inspect(op.get_bind())


def _has_table(table: str) -> bool:
    return table in _inspector().get_table_names()


def _columns(table: str) -> set[str]:
    return {c["name"] for c in _inspector().get_columns(table)}


def _has_fk(table: str, name: str) -> bool:
    return name in {fk.get("name") for fk in _inspector().get_foreign_keys(table)}


def upgrade() -> None:
    if _has_table(REPORTS):
        existing = _columns(REPORTS)
        if "submitted_at" not in existing:
            op.add_column(
                REPORTS,
                sa.Column("submitted_at", sa.DateTime(timezone=True), nullable=True),
            )
        if "late_acknowledged_by" not in existing:
            op.add_column(
                REPORTS,
                sa.Column("late_acknowledged_by", sa.String(36), nullable=True),
            )
        if "late_acknowledged_at" not in existing:
            op.add_column(
                REPORTS,
                sa.Column(
                    "late_acknowledged_at", sa.DateTime(timezone=True), nullable=True
                ),
            )
        if _has_table(USERS) and not _has_fk(REPORTS, ACK_FK):
            op.create_foreign_key(
                ACK_FK,
                REPORTS,
                USERS,
                ["late_acknowledged_by"],
                ["id"],
                ondelete="SET NULL",
            )

    if _has_table(LINES) and "substantiated_late" not in _columns(LINES):
        op.add_column(
            LINES,
            sa.Column(
                "substantiated_late",
                sa.Boolean(),
                nullable=False,
                server_default=sa.text("0"),
            ),
        )


def downgrade() -> None:
    if _has_table(LINES) and "substantiated_late" in _columns(LINES):
        op.drop_column(LINES, "substantiated_late")

    if _has_table(REPORTS):
        if _has_fk(REPORTS, ACK_FK):
            op.drop_constraint(ACK_FK, REPORTS, type_="foreignkey")
        existing = _columns(REPORTS)
        for name in REPORT_COLUMNS:
            if name in existing:
                op.drop_column(REPORTS, name)
