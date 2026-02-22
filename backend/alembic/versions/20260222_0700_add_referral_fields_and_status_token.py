"""Add referral fields to users and status_token to prospective_members

Preserves interest_reason, referral_source, and referred_by on the User
record after prospect-to-member transfer. Also adds a status_token column
so prospects can check their application status via a public link.

Revision ID: 20260222_0700
Revises: 20260222_0600
Create Date: 2026-02-22 07:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "20260222_0700"
down_revision: Union[str, None] = "20260222_0600"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # --- Users table: referral data preserved from prospect ---
    op.add_column("users", sa.Column("referral_source", sa.String(255), nullable=True))
    op.add_column("users", sa.Column("interest_reason", sa.Text(), nullable=True))
    op.add_column("users", sa.Column("referred_by_user_id", sa.String(36), nullable=True))
    op.create_foreign_key(
        "fk_users_referred_by_user_id",
        "users",
        "users",
        ["referred_by_user_id"],
        ["id"],
        ondelete="SET NULL",
    )

    # --- Prospective members table: status token for public status check ---
    op.add_column(
        "prospective_members",
        sa.Column("status_token", sa.String(64), nullable=True),
    )
    op.add_column(
        "prospective_members",
        sa.Column("status_token_created_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("idx_prospect_status_token", "prospective_members", ["status_token"], unique=True)


def downgrade() -> None:
    op.drop_index("idx_prospect_status_token", table_name="prospective_members")
    op.drop_column("prospective_members", "status_token_created_at")
    op.drop_column("prospective_members", "status_token")

    op.drop_constraint("fk_users_referred_by_user_id", "users", type_="foreignkey")
    op.drop_column("users", "referred_by_user_id")
    op.drop_column("users", "interest_reason")
    op.drop_column("users", "referral_source")
