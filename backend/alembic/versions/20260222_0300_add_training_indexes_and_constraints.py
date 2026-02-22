"""Add index on training_records.course_id and unique constraint on program_phases(program_id, phase_number)

Revision ID: 20260222_0300
Revises: 20260222_0200
Create Date: 2026-02-22 03:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
from sqlalchemy import inspect

# revision identifiers, used by Alembic.
revision: str = "20260222_0300"
down_revision: Union[str, None] = "20260222_0200"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _index_exists(connection, table_name: str, index_name: str) -> bool:
    insp = inspect(connection)
    return any(idx["name"] == index_name for idx in insp.get_indexes(table_name))


def _unique_constraint_exists(connection, table_name: str, constraint_name: str) -> bool:
    insp = inspect(connection)
    return any(uc["name"] == constraint_name for uc in insp.get_unique_constraints(table_name))


def upgrade() -> None:
    conn = op.get_bind()

    # Add index on training_records.course_id — frequently joined in reports
    if not _index_exists(conn, "training_records", "ix_training_records_course_id"):
        op.create_index(
            "ix_training_records_course_id",
            "training_records",
            ["course_id"],
        )

    # Add unique constraint on (program_id, phase_number) to prevent
    # duplicate phase numbers within the same program (race condition fix)
    if not _unique_constraint_exists(conn, "program_phases", "uq_program_phases_program_id_phase_number"):
        op.create_unique_constraint(
            "uq_program_phases_program_id_phase_number",
            "program_phases",
            ["program_id", "phase_number"],
        )


def downgrade() -> None:
    conn = op.get_bind()

    if _unique_constraint_exists(conn, "program_phases", "uq_program_phases_program_id_phase_number"):
        op.drop_constraint(
            "uq_program_phases_program_id_phase_number",
            "program_phases",
            type_="unique",
        )
    if _index_exists(conn, "training_records", "ix_training_records_course_id"):
        op.drop_index("ix_training_records_course_id", table_name="training_records")
