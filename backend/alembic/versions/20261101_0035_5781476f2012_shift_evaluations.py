"""Add shift evaluations

One row per member, per shift, per evaluation: the ratings and comments a
shift officer gives on a ``shift_evaluation_templates`` form, a copy of that
form, the header answers and statistics, and a draft/submitted status.

A new table, so no existing row is touched or needs settling (Pitfall #35).
``shift_id`` and ``template_id`` are SET NULL and nullable; the evaluation
keeps its own copy of the shift's date, times and unit, and of the template.

Downgrade drops the table and every evaluation in it. Once departments use
the feature that is a loss of training records: take a database backup
(``scripts/backup.sh``) before downgrading past this revision.

Revision ID: 5781476f2012
Revises: 3d0b6b6be048
Create Date: 2026-11-01 00:35:00

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "5781476f2012"
down_revision: Union[str, None] = "3d0b6b6be048"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

TABLE = "shift_evaluations"


def _has_table(table: str) -> bool:
    return sa.inspect(op.get_bind()).has_table(table)


def upgrade() -> None:
    if _has_table(TABLE):
        return
    op.create_table(
        TABLE,
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "organization_id",
            sa.String(36),
            sa.ForeignKey("organizations.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "shift_id",
            sa.String(36),
            sa.ForeignKey(
                "shifts.id", ondelete="SET NULL", name="fk_shift_evaluations_shift"
            ),
            nullable=True,
        ),
        sa.Column("shift_date", sa.Date(), nullable=False),
        sa.Column("shift_start", sa.DateTime(timezone=True), nullable=True),
        sa.Column("shift_end", sa.DateTime(timezone=True), nullable=True),
        sa.Column("unit_label", sa.String(200), nullable=True),
        sa.Column(
            "member_id",
            sa.String(36),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "evaluator_id",
            sa.String(36),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("scope_key", sa.String(40), nullable=False),
        sa.Column("enrollment_ids", sa.JSON(), nullable=False),
        sa.Column("program_names", sa.JSON(), nullable=False),
        sa.Column(
            "template_id",
            sa.String(36),
            sa.ForeignKey(
                "shift_evaluation_templates.id",
                ondelete="SET NULL",
                name="fk_shift_evaluations_template",
            ),
            nullable=True,
        ),
        sa.Column("template_version", sa.Integer(), nullable=False),
        sa.Column("template_snapshot", sa.JSON(), nullable=False),
        sa.Column("status", sa.String(20), nullable=False, server_default="draft"),
        sa.Column("header_values", sa.JSON(), nullable=False),
        sa.Column("statistics", sa.JSON(), nullable=False),
        # EncryptedJSON / EncryptedText in the model: ciphertext stored as TEXT.
        sa.Column("responses", sa.Text(), nullable=True),
        sa.Column("closing_comments", sa.Text(), nullable=True),
        sa.Column("average_rating", sa.Float(), nullable=True),
        sa.Column("rated_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("low_rating_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("submitted_at", sa.DateTime(timezone=True), nullable=True),
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
        sa.UniqueConstraint(
            "shift_id",
            "member_id",
            "scope_key",
            name="uq_shift_evaluation_shift_member_scope",
        ),
        sa.Index(
            "idx_shift_evaluation_org_member_date",
            "organization_id",
            "member_id",
            "shift_date",
        ),
        sa.Index("idx_shift_evaluation_org_shift", "organization_id", "shift_id"),
        mysql_charset="utf8mb4",
        mysql_collate="utf8mb4_unicode_ci",
    )


def downgrade() -> None:
    if _has_table(TABLE):
        op.drop_table(TABLE)
