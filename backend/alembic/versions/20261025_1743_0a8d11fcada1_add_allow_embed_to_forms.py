"""Add allow_embed to forms

Revision ID: 0a8d11fcada1
Revises: 3f2593e8071e
Create Date: 2026-10-25 17:43:35.296988

A public form may now be shown inside an ``<iframe>`` on a department's own
website, from ``/embed/f/<slug>``. Embedding loosens the clickjacking
protection every other page keeps, so it is opt-in per form: the column is
``NOT NULL`` with a server default of false, and every existing row reads as
false the moment the column exists — no form becomes embeddable by upgrading.

Safe to run twice: the column is added only when it is absent.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0a8d11fcada1"
down_revision: Union[str, None] = "3f2593e8071e"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

TABLE = "forms"


def _has_column(table: str, column: str) -> bool:
    inspector = sa.inspect(op.get_bind())
    return column in {c["name"] for c in inspector.get_columns(table)}


def upgrade() -> None:
    if not _has_column(TABLE, "allow_embed"):
        op.add_column(
            TABLE,
            sa.Column(
                "allow_embed",
                sa.Boolean(),
                nullable=False,
                server_default=sa.false(),
            ),
        )


def downgrade() -> None:
    if _has_column(TABLE, "allow_embed"):
        op.drop_column(TABLE, "allow_embed")
