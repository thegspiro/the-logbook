"""Add sensitive form fields

Revision ID: ce541de8d3da
Revises: 2382ef7e55c3
Create Date: 2026-10-25 23:09:42.000000

A form field can now be marked Sensitive. Answers to such a field are written
to ``form_submissions.sensitive_data`` — an AES-256-GCM encrypted TEXT column
(``EncryptedJSON``) — and never to the plain ``data`` JSON, so reading a
submission row, a backup or a replica does not yield them.

Existing rows need nothing settled: ``is_sensitive`` is ``NOT NULL`` with a
server default of false, so every existing field reads as not sensitive and
every existing answer stays where it is; ``sensitive_data`` is nullable and
NULL means the submission holds no sensitive answers.

Safe to run twice: each column is added only when it is absent.

**The downgrade refuses while any submission holds sensitive answers.**
Dropping the column would destroy those answers, and moving them back into
``data`` would write them out in plaintext — both are worse than a downgrade
that stops and says why. Before this revision has been used, the downgrade
simply drops both columns.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "ce541de8d3da"
down_revision: Union[str, None] = "2382ef7e55c3"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

FIELDS = "form_fields"
SUBMISSIONS = "form_submissions"


def _has_column(table: str, column: str) -> bool:
    inspector = sa.inspect(op.get_bind())
    return column in {c["name"] for c in inspector.get_columns(table)}


def upgrade() -> None:
    if not _has_column(FIELDS, "is_sensitive"):
        op.add_column(
            FIELDS,
            sa.Column(
                "is_sensitive",
                sa.Boolean(),
                nullable=False,
                server_default=sa.false(),
            ),
        )
    if not _has_column(SUBMISSIONS, "sensitive_data"):
        op.add_column(
            SUBMISSIONS, sa.Column("sensitive_data", sa.Text(), nullable=True)
        )


def downgrade() -> None:
    if _has_column(SUBMISSIONS, "sensitive_data"):
        held = op.get_bind().scalar(
            sa.text(
                f"SELECT COUNT(*) FROM {SUBMISSIONS} "
                "WHERE sensitive_data IS NOT NULL"
            )
        )
        if held:
            raise RuntimeError(
                f"{held} form submission(s) hold encrypted sensitive answers. "
                "Downgrading would destroy them; delete those submissions or "
                "restore the pre-upgrade database backup instead."
            )
        op.drop_column(SUBMISSIONS, "sensitive_data")
    if _has_column(FIELDS, "is_sensitive"):
        op.drop_column(FIELDS, "is_sensitive")
