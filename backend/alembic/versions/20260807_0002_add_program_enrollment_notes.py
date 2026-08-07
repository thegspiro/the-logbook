"""Add the missing program_enrollments.notes column

``ProgramEnrollmentBase`` has declared ``notes: Optional[str]`` since the
training-program schemas were written, so the field is accepted on
``POST /api/v1/training/programs/enrollments`` and returned on every enrollment
response. ``TrainingProgramService.enroll_member()`` duly forwards it to the ORM
as ``notes=enrollment_data.notes``.

The column was never added to ``ProgramEnrollment``. Because the kwarg is passed
unconditionally, SQLAlchemy raised ``TypeError: 'notes' is an invalid keyword
argument for ProgramEnrollment`` on *every* call — enrolling a member in a
training program returned 500 whether or not the client sent a note, and bulk
enroll failed the same way.

The model now declares the column, which fixes fresh installs built by
``create_all()``. This migration covers databases that already exist.

Revision ID: 20260807_0002
Revises: 20260807_0001
Create Date: 2026-08-07 00:00:00.000000

"""

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision = "20260807_0002"
down_revision = "20260807_0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    if not inspector.has_table("program_enrollments"):
        return
    columns = {c["name"] for c in inspector.get_columns("program_enrollments")}
    if "notes" in columns:
        return

    op.add_column("program_enrollments", sa.Column("notes", sa.Text(), nullable=True))


def downgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    if not inspector.has_table("program_enrollments"):
        return
    if "notes" not in {c["name"] for c in inspector.get_columns("program_enrollments")}:
        return

    op.drop_column("program_enrollments", "notes")
