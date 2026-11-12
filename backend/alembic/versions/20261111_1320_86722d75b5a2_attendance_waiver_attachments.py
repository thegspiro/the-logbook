"""Attendance waiver attachments

Revision ID: 86722d75b5a2
Revises: ccd374a66f82
Create Date: 2026-11-11 13:20:00.000000

Adds ``attendance_waiver_attachments``: the documents a member files with an
attendance waiver request when the department's policy takes them (owner
decisions, 2026-11-10). See ``app/models/attendance_waiver.py``, notably why
``(request_id, ordinal)`` is unique: it is the database's half of the
three-document limit.

One new table, so no existing row is touched and nothing needs settling
(CLAUDE.md pitfall #35). It is created only when absent, so a database whose
table ``create_all`` already built is left alone and a second run is
harmless. It references ``organizations`` and ``users``, which the initial
migrations create, and ``attendance_waiver_requests``, which revision
``8b1cf6f55425`` creates; the step is skipped while that table is missing
(pitfall #26), and ``create_all`` then builds both from the models.

The downgrade drops the table and the rows naming every filed document; the
files themselves stay on the uploads volume (or the department's bucket),
unreferenced. Nothing else refers to the table, so the previous release boots
against the downgraded database.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "86722d75b5a2"
down_revision: Union[str, None] = "ccd374a66f82"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

ATTACHMENTS = "attendance_waiver_attachments"
# Named so the migration's test can point it at scratch copies.
ORGANIZATIONS = "organizations"
USERS = "users"
REQUESTS = "attendance_waiver_requests"

UQ_REQUEST_ORDINAL = "uq_attendance_waiver_attachments_request_ordinal"
IX_ORG_REQUEST = "ix_attendance_waiver_attachments_org_request"


def upgrade() -> None:
    existing = set(sa.inspect(op.get_bind()).get_table_names())
    if ATTACHMENTS in existing or REQUESTS not in existing:
        return
    op.create_table(
        ATTACHMENTS,
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "organization_id",
            sa.String(36),
            sa.ForeignKey(f"{ORGANIZATIONS}.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "request_id",
            sa.String(36),
            sa.ForeignKey(f"{REQUESTS}.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("ordinal", sa.SmallInteger(), nullable=False),
        sa.Column("file_path", sa.String(500), nullable=False),
        sa.Column("mime_type", sa.String(100), nullable=False),
        sa.Column("file_size", sa.Integer(), nullable=False),
        sa.Column("sha256", sa.String(64), nullable=False),
        sa.Column(
            "uploaded_by",
            sa.String(36),
            sa.ForeignKey(f"{USERS}.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "uploaded_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.UniqueConstraint("request_id", "ordinal", name=UQ_REQUEST_ORDINAL),
    )
    op.create_index(IX_ORG_REQUEST, ATTACHMENTS, ["organization_id", "request_id"])


def downgrade() -> None:
    op.execute(f"DROP TABLE IF EXISTS {ATTACHMENTS}")
