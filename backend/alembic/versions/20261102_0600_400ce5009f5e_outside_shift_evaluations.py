"""Evaluate shifts members log on an outside agency's units

- ``external_agencies.evaluate_shifts``: whether shifts logged on this
  agency's units are evaluated like the department's own.
- ``shift_evaluations.occasion``: ``shift`` (a department shift) or
  ``external`` (a logged outside shift, ``external_shift_id``).
- ``shift_evaluations.external_shift_id``: SET NULL to
  ``external_shift_hours``, with its own unique key per member and scope so a
  second save lands on the same row (Pitfall #36).
- ``shift_evaluations.preceptor_name``: the outside preceptor, who has no
  account here.

Existing rows: every agency reads ``evaluate_shifts`` false, so nothing new is
asked of anyone until an officer switches an agency on; every evaluation is a
department-shift one, which the ``shift`` server default records. The new
unique key covers a column that is NULL on every existing row, and MySQL does
not compare NULLs in a unique key, so it cannot fail on data already there.

Downgrade deletes the outside-shift evaluations (there is nothing left to
attach them to) and drops the columns.

Revision ID: 400ce5009f5e
Revises: 857291750c67
Create Date: 2026-11-02 06:00:00

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "400ce5009f5e"
down_revision: Union[str, None] = "857291750c67"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

AGENCIES = "external_agencies"
EVALUATIONS = "shift_evaluations"
FK_NAME = "fk_shift_evaluations_external_shift"
UQ_NAME = "uq_shift_evaluation_external_member_scope"


def _columns(table: str) -> set[str] | None:
    inspector = sa.inspect(op.get_bind())
    if not inspector.has_table(table):
        # create_all builds it later from the models, columns included.
        return None
    return {c["name"] for c in inspector.get_columns(table)}


def upgrade() -> None:
    agency_columns = _columns(AGENCIES)
    if agency_columns is not None and "evaluate_shifts" not in agency_columns:
        op.add_column(
            AGENCIES,
            sa.Column(
                "evaluate_shifts", sa.Boolean(), nullable=False, server_default="0"
            ),
        )

    columns = _columns(EVALUATIONS)
    if columns is None:
        return
    if "occasion" not in columns:
        op.add_column(
            EVALUATIONS,
            sa.Column(
                "occasion", sa.String(20), nullable=False, server_default="shift"
            ),
        )
    if "external_shift_id" not in columns:
        op.add_column(
            EVALUATIONS,
            sa.Column("external_shift_id", sa.String(36), nullable=True),
        )
    if "preceptor_name" not in columns:
        op.add_column(
            EVALUATIONS, sa.Column("preceptor_name", sa.String(200), nullable=True)
        )

    inspector = sa.inspect(op.get_bind())
    if inspector.has_table("external_shift_hours") and FK_NAME not in {
        fk["name"] for fk in inspector.get_foreign_keys(EVALUATIONS)
    }:
        op.create_foreign_key(
            FK_NAME,
            EVALUATIONS,
            "external_shift_hours",
            ["external_shift_id"],
            ["id"],
            ondelete="SET NULL",
        )
    if UQ_NAME not in {
        uq["name"] for uq in inspector.get_unique_constraints(EVALUATIONS)
    } and UQ_NAME not in {ix["name"] for ix in inspector.get_indexes(EVALUATIONS)}:
        op.create_unique_constraint(
            UQ_NAME, EVALUATIONS, ["external_shift_id", "member_id", "scope_key"]
        )


def downgrade() -> None:
    columns = _columns(EVALUATIONS)
    if columns is not None:
        inspector = sa.inspect(op.get_bind())
        if "occasion" in columns:
            op.execute(
                sa.text(f"DELETE FROM {EVALUATIONS} WHERE occasion = 'external'")
            )
        # The FK first: MySQL will not drop a unique key an FK relies on.
        if FK_NAME in {fk["name"] for fk in inspector.get_foreign_keys(EVALUATIONS)}:
            op.drop_constraint(FK_NAME, EVALUATIONS, type_="foreignkey")
        if UQ_NAME in {
            uq["name"] for uq in inspector.get_unique_constraints(EVALUATIONS)
        } | {ix["name"] for ix in inspector.get_indexes(EVALUATIONS)}:
            op.drop_constraint(UQ_NAME, EVALUATIONS, type_="unique")
        for column in ("preceptor_name", "external_shift_id", "occasion"):
            if column in columns:
                op.drop_column(EVALUATIONS, column)

    agency_columns = _columns(AGENCIES)
    if agency_columns is not None and "evaluate_shifts" in agency_columns:
        op.drop_column(AGENCIES, "evaluate_shifts")
