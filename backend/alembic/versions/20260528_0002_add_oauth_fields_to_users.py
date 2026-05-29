"""add oauth provider/subject fields to users

Adds nullable ``oauth_provider`` and ``oauth_subject`` columns so a local user
can be linked to an external identity provider (Google) for "Sign in with
Google". Both are NULL for password-only accounts. ``oauth_subject`` is indexed
because login looks users up by the provider's stable subject id.

Revision ID: 20260528_0002
Revises: 20260528_0001
Create Date: 2026-05-28 00:00:00.000000

"""

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "20260528_0002"
down_revision = "20260528_0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "users", sa.Column("oauth_provider", sa.String(length=50), nullable=True)
    )
    op.add_column(
        "users", sa.Column("oauth_subject", sa.String(length=255), nullable=True)
    )
    op.create_index("ix_users_oauth_subject", "users", ["oauth_subject"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_users_oauth_subject", table_name="users")
    op.drop_column("users", "oauth_subject")
    op.drop_column("users", "oauth_provider")
