"""Member performance evaluations

Revision ID: 3fbd0fe30e5b
Revises: c588f525fdbb
Create Date: 2026-10-31 17:05:00.000000

Adds the nine tables behind member performance evaluations
(``app/models/evaluation.py``): templates and their frozen versions, review
periods, evaluations with their workflow steps, authored parts, signatures,
amendments, and the permanent record left when an evaluation is deleted.

All new tables, so no existing row is touched and nothing needs settling
(CLAUDE.md pitfall #35). Each table is created only when absent, so a database
whose tables ``create_all`` already built — a fresh install stamped at head —
is left alone, and running the upgrade twice is harmless.

``evaluations.member_id`` and ``evaluation_deletion_records.member_id`` are
``ON DELETE RESTRICT``: a member with evaluation history cannot be
hard-deleted, which ``user_deletion_service`` reports as a blocker so the
member is archived instead. No existing member has evaluation rows yet, so no
current hard delete is affected by this upgrade.

The downgrade drops the tables, children first, and every evaluation with
them. That is a real loss of personnel records once the feature is in use;
take a database backup (``scripts/backup.sh``) before downgrading past this
revision.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "3fbd0fe30e5b"
down_revision: Union[str, None] = "c588f525fdbb"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# Children before parents, which is the order the downgrade drops them in.
_TABLES = (
    "evaluation_deletion_records",
    "evaluation_amendments",
    "evaluation_signatures",
    "evaluation_parts",
    "evaluation_steps",
    "evaluations",
    "evaluation_periods",
    "evaluation_template_versions",
    "evaluation_templates",
)


def _has_table(name: str) -> bool:
    return name in sa.inspect(op.get_bind()).get_table_names()


def _id() -> sa.Column:
    return sa.Column("id", sa.String(36), primary_key=True)


def _org() -> sa.Column:
    return sa.Column(
        "organization_id",
        sa.String(36),
        sa.ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
    )


def _user_ref(name: str) -> sa.Column:
    return sa.Column(
        name,
        sa.String(36),
        sa.ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )


def _evaluation_ref() -> sa.Column:
    return sa.Column(
        "evaluation_id",
        sa.String(36),
        sa.ForeignKey("evaluations.id", ondelete="CASCADE"),
        nullable=False,
    )


def _timestamps() -> list[sa.Column]:
    return [
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=True,
            server_default=sa.func.now(),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=True,
            server_default=sa.func.now(),
        ),
    ]


def upgrade() -> None:
    if not _has_table("evaluation_templates"):
        op.create_table(
            "evaluation_templates",
            _id(),
            _org(),
            sa.Column("name", sa.String(150), nullable=False),
            sa.Column("description", sa.Text(), nullable=True),
            sa.Column("kind", sa.String(16), nullable=False, server_default="annual"),
            sa.Column("member_class", sa.String(20), nullable=True),
            sa.Column("member_status", sa.String(20), nullable=True),
            sa.Column("is_active", sa.Boolean(), nullable=False, server_default="1"),
            _user_ref("created_by"),
            *_timestamps(),
            sa.UniqueConstraint(
                "organization_id", "name", name="uq_evaluation_templates_org_name"
            ),
        )
        op.create_index(
            "ix_evaluation_templates_org_active",
            "evaluation_templates",
            ["organization_id", "is_active"],
        )

    if not _has_table("evaluation_template_versions"):
        op.create_table(
            "evaluation_template_versions",
            _id(),
            _org(),
            sa.Column(
                "template_id",
                sa.String(36),
                sa.ForeignKey("evaluation_templates.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column("version_number", sa.Integer(), nullable=False),
            sa.Column("definition", sa.JSON(), nullable=False),
            sa.Column("workflow", sa.JSON(), nullable=False),
            sa.Column("published_at", sa.DateTime(timezone=True), nullable=True),
            _user_ref("published_by"),
            _user_ref("created_by"),
            *_timestamps(),
            sa.UniqueConstraint(
                "template_id",
                "version_number",
                name="uq_evaluation_template_versions_number",
            ),
        )
        op.create_index(
            "ix_evaluation_template_versions_org_template",
            "evaluation_template_versions",
            ["organization_id", "template_id"],
        )

    if not _has_table("evaluation_periods"):
        op.create_table(
            "evaluation_periods",
            _id(),
            _org(),
            sa.Column("name", sa.String(150), nullable=False),
            sa.Column("start_date", sa.Date(), nullable=False),
            sa.Column("end_date", sa.Date(), nullable=False),
            sa.Column("is_closed", sa.Boolean(), nullable=False, server_default="0"),
            _user_ref("created_by"),
            *_timestamps(),
            sa.UniqueConstraint(
                "organization_id", "name", name="uq_evaluation_periods_org_name"
            ),
            sa.CheckConstraint("end_date >= start_date", name="date_order"),
        )
        op.create_index(
            "ix_evaluation_periods_org_dates",
            "evaluation_periods",
            ["organization_id", "start_date"],
        )

    if not _has_table("evaluations"):
        op.create_table(
            "evaluations",
            _id(),
            _org(),
            sa.Column(
                "member_id",
                sa.String(36),
                sa.ForeignKey("users.id", ondelete="RESTRICT"),
                nullable=False,
            ),
            _user_ref("evaluator_id"),
            sa.Column(
                "period_id",
                sa.String(36),
                sa.ForeignKey("evaluation_periods.id", ondelete="RESTRICT"),
                nullable=True,
            ),
            sa.Column(
                "template_version_id",
                sa.String(36),
                sa.ForeignKey("evaluation_template_versions.id", ondelete="RESTRICT"),
                nullable=False,
            ),
            sa.Column(
                "status",
                sa.String(20),
                nullable=False,
                server_default="in_progress",
            ),
            sa.Column("revision", sa.Integer(), nullable=False, server_default="1"),
            sa.Column("period_start", sa.Date(), nullable=False),
            sa.Column("period_end", sa.Date(), nullable=False),
            sa.Column("coverage_start", sa.Date(), nullable=True),
            sa.Column("coverage_end", sa.Date(), nullable=True),
            sa.Column("excluded_ranges", sa.JSON(), nullable=True),
            sa.Column(
                "includes_officer_sections",
                sa.Boolean(),
                nullable=False,
                server_default="0",
            ),
            sa.Column("data_snapshot", sa.JSON(), nullable=True),
            sa.Column("snapshot_taken_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("finalized_at", sa.DateTime(timezone=True), nullable=True),
            _user_ref("created_by"),
            *_timestamps(),
            sa.UniqueConstraint(
                "member_id", "period_id", name="uq_evaluations_member_period"
            ),
            sa.CheckConstraint("period_end >= period_start", name="period_order"),
        )
        for name, columns in (
            ("ix_evaluations_org_status", ["organization_id", "status"]),
            ("ix_evaluations_org_member", ["organization_id", "member_id"]),
            ("ix_evaluations_org_evaluator", ["organization_id", "evaluator_id"]),
            ("ix_evaluations_org_period", ["organization_id", "period_id"]),
        ):
            op.create_index(name, "evaluations", columns)

    if not _has_table("evaluation_steps"):
        op.create_table(
            "evaluation_steps",
            _id(),
            _org(),
            _evaluation_ref(),
            sa.Column("revision", sa.Integer(), nullable=False),
            sa.Column("step_key", sa.String(50), nullable=False),
            sa.Column("step_order", sa.Integer(), nullable=False),
            sa.Column("step_type", sa.String(30), nullable=False),
            sa.Column(
                "status", sa.String(16), nullable=False, server_default="pending"
            ),
            sa.Column("due_date", sa.Date(), nullable=True),
            sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
            _user_ref("completed_by"),
            *_timestamps(),
            sa.UniqueConstraint(
                "evaluation_id",
                "revision",
                "step_key",
                name="uq_evaluation_steps_key",
            ),
        )
        op.create_index(
            "ix_evaluation_steps_org_due",
            "evaluation_steps",
            ["organization_id", "status", "due_date"],
        )

    if not _has_table("evaluation_parts"):
        op.create_table(
            "evaluation_parts",
            _id(),
            _org(),
            _evaluation_ref(),
            sa.Column("revision", sa.Integer(), nullable=False),
            sa.Column("kind", sa.String(24), nullable=False),
            _user_ref("author_id"),
            sa.Column("content", sa.JSON(), nullable=False),
            sa.Column("status", sa.String(16), nullable=False, server_default="draft"),
            sa.Column("submitted_at", sa.DateTime(timezone=True), nullable=True),
            *_timestamps(),
            sa.UniqueConstraint(
                "evaluation_id", "revision", "kind", name="uq_evaluation_parts_kind"
            ),
        )
        op.create_index(
            "ix_evaluation_parts_org_eval",
            "evaluation_parts",
            ["organization_id", "evaluation_id"],
        )

    if not _has_table("evaluation_signatures"):
        op.create_table(
            "evaluation_signatures",
            _id(),
            _org(),
            _evaluation_ref(),
            sa.Column("revision", sa.Integer(), nullable=False),
            sa.Column("step_key", sa.String(50), nullable=False),
            _user_ref("signer_id"),
            sa.Column("signed_name", sa.String(200), nullable=False),
            sa.Column("disposition", sa.String(20), nullable=False),
            sa.Column("comment", sa.Text(), nullable=True),
            sa.Column("intent_confirmed", sa.Boolean(), nullable=False),
            sa.Column("content_hash", sa.String(64), nullable=False),
            sa.Column("ip_address", sa.String(45), nullable=True),
            sa.Column("user_agent", sa.String(512), nullable=True),
            sa.Column("signed_at", sa.DateTime(timezone=True), nullable=False),
            sa.UniqueConstraint(
                "evaluation_id",
                "revision",
                "step_key",
                name="uq_evaluation_signatures_step",
            ),
        )
        op.create_index(
            "ix_evaluation_signatures_org_eval",
            "evaluation_signatures",
            ["organization_id", "evaluation_id"],
        )

    if not _has_table("evaluation_amendments"):
        op.create_table(
            "evaluation_amendments",
            _id(),
            _org(),
            _evaluation_ref(),
            sa.Column("from_revision", sa.Integer(), nullable=False),
            sa.Column("to_revision", sa.Integer(), nullable=False),
            sa.Column("reason", sa.Text(), nullable=False),
            _user_ref("amended_by"),
            sa.Column(
                "amended_at",
                sa.DateTime(timezone=True),
                nullable=False,
                server_default=sa.func.now(),
            ),
            sa.UniqueConstraint(
                "evaluation_id",
                "to_revision",
                name="uq_evaluation_amendments_revision",
            ),
        )
        op.create_index(
            "ix_evaluation_amendments_org_eval",
            "evaluation_amendments",
            ["organization_id", "evaluation_id"],
        )

    if not _has_table("evaluation_deletion_records"):
        op.create_table(
            "evaluation_deletion_records",
            _id(),
            _org(),
            sa.Column(
                "member_id",
                sa.String(36),
                sa.ForeignKey("users.id", ondelete="RESTRICT"),
                nullable=False,
            ),
            # No foreign key: the evaluation this names has been deleted.
            sa.Column("evaluation_id", sa.String(36), nullable=False),
            sa.Column("period_name", sa.String(150), nullable=True),
            sa.Column("period_start", sa.Date(), nullable=False),
            sa.Column("period_end", sa.Date(), nullable=False),
            sa.Column("template_name", sa.String(150), nullable=False),
            sa.Column("evaluator_name", sa.String(200), nullable=True),
            sa.Column("was_finalized", sa.Boolean(), nullable=False),
            sa.Column("reason", sa.Text(), nullable=False),
            _user_ref("deleted_by"),
            sa.Column("deleted_by_name", sa.String(200), nullable=False),
            sa.Column(
                "deleted_at",
                sa.DateTime(timezone=True),
                nullable=False,
                server_default=sa.func.now(),
            ),
            sa.UniqueConstraint(
                "evaluation_id", name="uq_evaluation_deletion_records_evaluation"
            ),
        )
        op.create_index(
            "ix_evaluation_deletion_records_org_member",
            "evaluation_deletion_records",
            ["organization_id", "member_id"],
        )


def downgrade() -> None:
    for table in _TABLES:
        op.execute(f"DROP TABLE IF EXISTS {table}")
