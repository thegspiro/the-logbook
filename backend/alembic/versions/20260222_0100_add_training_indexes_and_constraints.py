"""Add index on training_records.course_id and unique constraint on program_phases(program_id, phase_number)

Revision ID: 20260222_0100
Revises: 20260221_0800
Create Date: 2026-02-22 01:00:00.000000

"""
from typing import Sequence, Union

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "20260222_0100"
down_revision: Union[str, None] = "20260221_0800"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Add index on training_records.course_id — frequently joined in reports
    op.create_index(
        "ix_training_records_course_id",
        "training_records",
        ["course_id"],
    )

    # Add unique constraint on (program_id, phase_number) to prevent
    # duplicate phase numbers within the same program (race condition fix)
    op.create_unique_constraint(
        "uq_program_phases_program_id_phase_number",
        "program_phases",
        ["program_id", "phase_number"],
    )


def downgrade() -> None:
    op.drop_constraint(
        "uq_program_phases_program_id_phase_number",
        "program_phases",
        type_="unique",
    )
    op.drop_index("ix_training_records_course_id", table_name="training_records")
