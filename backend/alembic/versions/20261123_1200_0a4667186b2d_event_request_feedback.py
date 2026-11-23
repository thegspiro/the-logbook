"""Event request feedback: one response per request, from the department's form

Revision ID: 0a4667186b2d
Revises: b6e3d1f47a29
Create Date: 2026-11-23 12:00:00.000000

Creates ``event_request_feedback``: a requester's answers to the department's
feedback form, sent through their status link once the request is Completed.
The answers are a ``form_submissions`` row; this table ties it to the request,
unique per request, with the rating copied from the answer the department
named as the rating.

Existing rows: a new table only. Nothing is backfilled and no existing table
is altered. ``event_requests`` is built by ``create_all`` and by no migration
(pitfall #26), so on a database that has not started the app yet the step is
skipped, and ``create_all`` builds this table from the model. Safe to run
twice.

Downgrade drops the table and every response in it. The answers survive as
``form_submissions`` rows of the feedback form, but their link to a request,
and so the report's ratings, does not.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0a4667186b2d"
down_revision: Union[str, None] = "b6e3d1f47a29"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

TABLE = "event_request_feedback"


def _has_table(table: str) -> bool:
    return table in sa.inspect(op.get_bind()).get_table_names()


def upgrade() -> None:
    if _has_table(TABLE) or not _has_table("event_requests"):
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
            "request_id",
            sa.String(36),
            sa.ForeignKey("event_requests.id", ondelete="CASCADE"),
            nullable=False,
            unique=True,
        ),
        sa.Column(
            "form_id",
            sa.String(36),
            sa.ForeignKey("forms.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "form_submission_id",
            sa.String(36),
            sa.ForeignKey("form_submissions.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("rating", sa.Integer(), nullable=True),
        sa.Column(
            "submitted_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        mysql_charset="utf8mb4",
        mysql_collate="utf8mb4_unicode_ci",
    )
    op.create_index(
        "idx_event_req_feedback_org_submitted",
        TABLE,
        ["organization_id", "submitted_at"],
    )


def downgrade() -> None:
    if _has_table(TABLE):
        op.drop_table(TABLE)
