"""Let a Chief override a session-attendance requirement for a member

- ``training_requirements.allows_chief_override``: whether a requirement
  accepts an override. NOT NULL with a server default of false, so every
  existing requirement reads as not accepting one.
- ``training_requirement_overrides``: a Chief's ruling that a member meets a
  requirement whenever it is graded as of a date in ``start_date`` to
  ``end_date``. The reason is stored encrypted (Text, as every EncryptedText
  column is). Rows are revoked, never deleted, so the grant stays on record.

Existing rows: the new column has a default and the new table starts empty,
so nothing already graded changes.

Downgrade drops the table and the column; the overrides recorded, and which
requirements accepted them, are lost on the way down.

Revision ID: 9446e373c7a3
Revises: 89cfef37cca8
Create Date: 2026-11-05 01:00:00

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "9446e373c7a3"
down_revision: Union[str, None] = "89cfef37cca8"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

REQUIREMENTS = "training_requirements"
OVERRIDES = "training_requirement_overrides"


def _has_table(bind, table: str) -> bool:
    return (
        bind.execute(
            sa.text(
                "SELECT COUNT(*) FROM information_schema.TABLES "
                "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :table"
            ),
            {"table": table},
        ).scalar()
        > 0
    )


def _has_column(bind, table: str, column: str) -> bool:
    return (
        bind.execute(
            sa.text(
                "SELECT COUNT(*) FROM information_schema.COLUMNS "
                "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :table "
                "AND COLUMN_NAME = :column"
            ),
            {"table": table, "column": column},
        ).scalar()
        > 0
    )


def upgrade() -> None:
    bind = op.get_bind()
    # No requirements table: create_all builds it, and the overrides table,
    # from the models later, the new column included.
    if not _has_table(bind, REQUIREMENTS):
        return

    if not _has_column(bind, REQUIREMENTS, "allows_chief_override"):
        op.add_column(
            REQUIREMENTS,
            sa.Column(
                "allows_chief_override",
                sa.Boolean(),
                nullable=False,
                server_default="0",
            ),
        )

    if not _has_table(bind, OVERRIDES):
        op.create_table(
            OVERRIDES,
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column(
                "organization_id",
                sa.String(36),
                sa.ForeignKey("organizations.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column(
                "requirement_id",
                sa.String(36),
                sa.ForeignKey("training_requirements.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column(
                "user_id",
                sa.String(36),
                sa.ForeignKey("users.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column("start_date", sa.Date(), nullable=False),
            sa.Column("end_date", sa.Date(), nullable=False),
            sa.Column("reason", sa.Text(), nullable=False),
            sa.Column(
                "granted_by",
                sa.String(36),
                sa.ForeignKey("users.id", ondelete="SET NULL"),
                nullable=True,
            ),
            sa.Column(
                "granted_at",
                sa.DateTime(timezone=True),
                server_default=sa.func.now(),
                nullable=False,
            ),
            sa.Column(
                "revoked_by",
                sa.String(36),
                sa.ForeignKey("users.id", ondelete="SET NULL"),
                nullable=True,
            ),
            sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        )
        op.create_index(
            "idx_requirement_override_org_req_user",
            OVERRIDES,
            ["organization_id", "requirement_id", "user_id"],
        )


def downgrade() -> None:
    bind = op.get_bind()
    if _has_table(bind, OVERRIDES):
        op.drop_table(OVERRIDES)
    if _has_table(bind, REQUIREMENTS) and _has_column(
        bind, REQUIREMENTS, "allows_chief_override"
    ):
        op.drop_column(REQUIREMENTS, "allows_chief_override")
