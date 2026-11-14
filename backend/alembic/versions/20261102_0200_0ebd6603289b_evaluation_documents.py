"""Evaluation documents: the frozen PDF of each finalized revision

Revision ID: 0ebd6603289b
Revises: e059227da2c0
Create Date: 2026-11-02 02:00:00.000000

Adds ``evaluation_documents`` (owner decision 2026-11-02): the PDF generated
once when the last signature finalizes an evaluation's revision, kept as
that exact file with a fingerprint of its bytes and the hash of the record
its signers attested to. One row per evaluation revision.

A new table, so no existing row is touched (CLAUDE.md pitfall #35). It is
created only when absent, so a database whose table ``create_all`` already
built — a fresh install stamped at head — is left alone, and running the
upgrade twice is harmless.

The downgrade drops the table. The PDF files stay in storage; the rows that
pointed at them do not, so take a backup before downgrading past this
revision once evaluations have been finalized.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0ebd6603289b"
down_revision: Union[str, None] = "e059227da2c0"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

TABLE = "evaluation_documents"


def _has_table() -> bool:
    return TABLE in sa.inspect(op.get_bind()).get_table_names()


def upgrade() -> None:
    if _has_table():
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
            "evaluation_id",
            sa.String(36),
            sa.ForeignKey("evaluations.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("file_path", sa.String(500), nullable=False),
        sa.Column("file_sha256", sa.String(64), nullable=False),
        sa.Column("content_hash", sa.String(64), nullable=False),
        sa.Column("size_bytes", sa.Integer(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.UniqueConstraint(
            "evaluation_id", "revision", name="uq_evaluation_documents_revision"
        ),
        mysql_charset="utf8mb4",
        mysql_collate="utf8mb4_unicode_ci",
    )
    op.create_index(
        "ix_evaluation_documents_org_eval",
        TABLE,
        ["organization_id", "evaluation_id"],
    )


def downgrade() -> None:
    if _has_table():
        op.drop_table(TABLE)
