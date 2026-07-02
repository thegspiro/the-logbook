"""Make training actor/audit FKs ON DELETE SET NULL

Every audit/actor reference in the training module (created_by, updated_by,
approved_by, reviewed_by, verified_by, granted_by, evaluated_by, etc.) was a
bare ``ForeignKey("users.id")`` with no ``ondelete``. MySQL defaults those to
RESTRICT, so deleting a user who had ever created, approved, reviewed, or
evaluated any training artifact failed with FK error 1451 — a user could never
be removed once they touched the training module.

This migration switches each of those columns to ``ON DELETE SET NULL`` so the
actor link is cleared (preserving the historical record) when a user is
deleted. ``skill_checkoffs.evaluator_id`` was additionally NOT NULL; it is
relaxed to nullable so SET NULL is legal (MySQL rejects SET NULL on a NOT NULL
column, error 1830).

Because the existing FK constraint names are MySQL auto-generated
(``<table>_ibfk_N``) and vary per environment, the constraints are discovered
via the inspector at run time rather than by hard-coded name.

Revision ID: 20260702_0001
Revises: 20260622_0001
Create Date: 2026-07-02 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "20260702_0001"
down_revision = "20260622_0001"
branch_labels = None
depends_on = None


# (table, column) for every training audit/actor FK that referenced users.id
# without an ondelete rule. Ordered by table for readability.
ACTOR_FKS = [
    ("training_categories", "created_by"),
    ("training_courses", "created_by"),
    ("training_records", "created_by"),
    ("training_requirements", "created_by"),
    ("training_sessions", "finalized_by"),
    ("training_sessions", "created_by"),
    ("training_approvals", "approved_by"),
    ("training_programs", "created_by"),
    ("program_enrollments", "enrolled_by"),
    ("requirement_progress", "verified_by"),
    ("skill_evaluations", "created_by"),
    ("skill_checkoffs", "evaluator_id"),
    ("training_module_configs", "updated_by"),
    ("self_report_configs", "updated_by"),
    ("training_submissions", "reviewed_by"),
    ("external_training_providers", "created_by"),
    ("external_category_mappings", "mapped_by"),
    ("external_user_mappings", "mapped_by"),
    ("external_training_sync_logs", "initiated_by"),
    ("shifts", "created_by"),
    ("training_waivers", "granted_by"),
    ("recertification_pathways", "created_by"),
    ("competency_matrices", "created_by"),
    ("member_competencies", "last_evaluator_id"),
    ("instructor_qualifications", "verified_by"),
    ("instructor_qualifications", "created_by"),
    ("training_effectiveness_evaluations", "evaluated_by"),
    ("multi_agency_trainings", "created_by"),
]

# Column that must also be relaxed from NOT NULL for SET NULL to be legal.
NOT_NULL_COLUMNS = {("skill_checkoffs", "evaluator_id")}


def _fk_name(table: str, column: str) -> str:
    """Deterministic, <=64-char constraint name for the recreated FK."""
    return f"fk_{table}_{column}"


def _drop_user_fks(inspector, table: str, column: str) -> None:
    """Drop any FK on ``table.column`` that references the users table."""
    for fk in inspector.get_foreign_keys(table):
        if fk.get("referred_table") == "users" and fk.get(
            "constrained_columns"
        ) == [column]:
            name = fk.get("name")
            if name:
                op.drop_constraint(name, table, type_="foreignkey")


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    for table, column in ACTOR_FKS:
        # Reflection results are cached per inspector; clear before each
        # lookup so tables with two target columns (e.g.
        # instructor_qualifications) always see current, post-drop state.
        inspector.clear_cache()

        _drop_user_fks(inspector, table, column)

        if (table, column) in NOT_NULL_COLUMNS:
            op.alter_column(
                table,
                column,
                existing_type=sa.String(length=36),
                nullable=True,
            )

        op.create_foreign_key(
            _fk_name(table, column),
            table,
            "users",
            [column],
            ["id"],
            ondelete="SET NULL",
        )


def downgrade() -> None:
    # Recreate the FKs without an ondelete rule (MySQL default RESTRICT) and
    # restore the NOT NULL constraint. Note: if users were deleted while SET
    # NULL was active, affected rows now hold NULL and restoring NOT NULL will
    # fail until those rows are backfilled — an inherent downgrade hazard.
    for table, column in ACTOR_FKS:
        op.drop_constraint(_fk_name(table, column), table, type_="foreignkey")

        if (table, column) in NOT_NULL_COLUMNS:
            op.alter_column(
                table,
                column,
                existing_type=sa.String(length=36),
                nullable=False,
            )

        op.create_foreign_key(
            None,
            table,
            "users",
            [column],
            ["id"],
        )
