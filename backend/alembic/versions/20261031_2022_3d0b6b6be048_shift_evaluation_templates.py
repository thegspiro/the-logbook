"""Add shift evaluation templates

A department's own evaluation forms (the paper "EMT Shift Evaluation"),
stored as data so training officers can edit the scale, the items and the
comment rules without a release.

- ``shift_evaluation_templates``: one row per form, per department.
- ``training_programs.shift_evaluation_template_id``: the form a member enrolled in
  the program is evaluated on.
- ``training_module_configs``: the department's general form, how it is used
  (off / optional / required) and whether one evaluation may count for every
  program a member is enrolled in.

Named ``shift_evaluation_*`` throughout: ``evaluation_templates`` belongs to
member performance evaluations (``3fbd0fe30e5b``), a different feature.

Existing rows: every new column is nullable or carries a server default, so
the rows already present take NULL (no form, general mode "off") or ``0``
(one evaluation per program). Nothing is backfilled and no behaviour changes
until a training officer creates a template and attaches it.

Downgrade drops the three settings columns, the program column and the table,
in dependency order. Templates a department created are lost with the table;
nothing else references them yet.

Revision ID: 3d0b6b6be048
Revises: 3fbd0fe30e5b
Create Date: 2026-10-31 20:22:56.078131

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "3d0b6b6be048"
down_revision: Union[str, None] = "3fbd0fe30e5b"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

TEMPLATES = "shift_evaluation_templates"
PROGRAMS = "training_programs"
CONFIGS = "training_module_configs"

PROGRAM_FK = "fk_training_programs_shift_evaluation_template"
GENERAL_FK = "fk_training_module_configs_general_shift_evaluation_template"


def _has_table(table: str) -> bool:
    return sa.inspect(op.get_bind()).has_table(table)


def _columns(table: str) -> set[str]:
    return {c["name"] for c in sa.inspect(op.get_bind()).get_columns(table)}


def _fks_on(table: str, column: str) -> list[str]:
    """Every foreign key on ``column``, whatever it is called.

    A database built by ``create_all`` names its keys itself, so the downgrade
    cannot rely on the names this migration gives them.
    """
    return [
        fk["name"]
        for fk in sa.inspect(op.get_bind()).get_foreign_keys(table)
        if fk.get("name") and fk.get("constrained_columns") == [column]
    ]


def upgrade() -> None:
    if not _has_table(TEMPLATES):
        op.create_table(
            TEMPLATES,
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column(
                "organization_id",
                sa.String(36),
                sa.ForeignKey("organizations.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column("name", sa.String(200), nullable=False),
            sa.Column("description", sa.Text(), nullable=True),
            sa.Column("is_active", sa.Boolean(), nullable=False, server_default="1"),
            sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
            sa.Column("scale", sa.JSON(), nullable=False),
            sa.Column(
                "allow_not_applicable",
                sa.Boolean(),
                nullable=False,
                server_default="1",
            ),
            sa.Column(
                "not_applicable_label",
                sa.String(100),
                nullable=False,
                server_default="Not Observed",
            ),
            sa.Column("comment_required_at_or_below", sa.Integer(), nullable=True),
            sa.Column("header_fields", sa.JSON(), nullable=False),
            sa.Column("statistics", sa.JSON(), nullable=False),
            sa.Column("sections", sa.JSON(), nullable=False),
            sa.Column("closing_comments_label", sa.String(200), nullable=True),
            sa.Column("closing_comments_hint", sa.String(500), nullable=True),
            sa.Column(
                "evaluator_rule",
                sa.String(30),
                nullable=False,
                server_default="shift_officer",
            ),
            sa.Column("evaluated_seats", sa.JSON(), nullable=False),
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
            sa.Column(
                "created_by",
                sa.String(36),
                sa.ForeignKey("users.id", ondelete="SET NULL"),
                nullable=True,
            ),
            sa.Column(
                "updated_by",
                sa.String(36),
                sa.ForeignKey("users.id", ondelete="SET NULL"),
                nullable=True,
            ),
            sa.Index(
                "idx_shift_evaluation_template_org_active",
                "organization_id",
                "is_active",
            ),
            sa.UniqueConstraint(
                "organization_id", "name", name="uq_shift_evaluation_template_org_name"
            ),
            mysql_charset="utf8mb4",
            mysql_collate="utf8mb4_unicode_ci",
        )

    if _has_table(PROGRAMS):
        if "shift_evaluation_template_id" not in _columns(PROGRAMS):
            op.add_column(
                PROGRAMS,
                sa.Column("shift_evaluation_template_id", sa.String(36), nullable=True),
            )
        if not _fks_on(PROGRAMS, "shift_evaluation_template_id"):
            op.create_foreign_key(
                PROGRAM_FK,
                PROGRAMS,
                TEMPLATES,
                ["shift_evaluation_template_id"],
                ["id"],
                ondelete="SET NULL",
            )

    if _has_table(CONFIGS):
        existing = _columns(CONFIGS)
        if "general_shift_evaluation_template_id" not in existing:
            op.add_column(
                CONFIGS,
                sa.Column(
                    "general_shift_evaluation_template_id", sa.String(36), nullable=True
                ),
            )
        if "general_shift_evaluation_mode" not in existing:
            op.add_column(
                CONFIGS,
                sa.Column(
                    "general_shift_evaluation_mode", sa.String(20), nullable=True
                ),
            )
        if "one_shift_evaluation_for_multiple_programs" not in existing:
            op.add_column(
                CONFIGS,
                sa.Column(
                    "one_shift_evaluation_for_multiple_programs",
                    sa.Boolean(),
                    nullable=False,
                    server_default="0",
                ),
            )
        if not _fks_on(CONFIGS, "general_shift_evaluation_template_id"):
            op.create_foreign_key(
                GENERAL_FK,
                CONFIGS,
                TEMPLATES,
                ["general_shift_evaluation_template_id"],
                ["id"],
                ondelete="SET NULL",
            )


def downgrade() -> None:
    if _has_table(CONFIGS):
        for fk in _fks_on(CONFIGS, "general_shift_evaluation_template_id"):
            op.drop_constraint(fk, CONFIGS, type_="foreignkey")
        existing = _columns(CONFIGS)
        for name in (
            "one_shift_evaluation_for_multiple_programs",
            "general_shift_evaluation_mode",
            "general_shift_evaluation_template_id",
        ):
            if name in existing:
                op.drop_column(CONFIGS, name)

    if _has_table(PROGRAMS):
        for fk in _fks_on(PROGRAMS, "shift_evaluation_template_id"):
            op.drop_constraint(fk, PROGRAMS, type_="foreignkey")
        if "shift_evaluation_template_id" in _columns(PROGRAMS):
            op.drop_column(PROGRAMS, "shift_evaluation_template_id")

    if _has_table(TEMPLATES):
        op.drop_table(TEMPLATES)
