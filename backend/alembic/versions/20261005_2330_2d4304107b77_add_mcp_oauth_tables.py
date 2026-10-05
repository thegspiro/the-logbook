"""Add the MCP OAuth 2.1 authorization-server tables.

``mcp_oauth_clients`` holds the MCP clients an IT administrator registered
for a department, ``mcp_oauth_authorizations`` the pending consent requests
and their one-time codes, and ``mcp_oauth_grants`` each member's connection
with the digests of its current access and refresh tokens. Nothing is
backfilled: the feature is off until an operator sets ``MCP_OAUTH_ENABLED``
and a department switches it on, so an upgraded installation behaves exactly
as before.

**Reversible.** The downgrade drops the three tables. Every OAuth-connected
MCP client then stops authenticating, which is the correct consequence of
removing the feature; service keys (``mcp_service_keys``) are untouched and
nothing else references these tables.

Each step is guarded on the table's existence: an installation whose
``create_all`` fast path already built them from the models must not fail
the whole upgrade re-creating them (docs/rules/migrations.md).

Revision ID: 2d4304107b77
Revises: 01f36743137a
Create Date: 2026-10-05 23:30:19.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "2d4304107b77"
down_revision: Union[str, None] = "01f36743137a"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_CLIENTS = "mcp_oauth_clients"
_GRANTS = "mcp_oauth_grants"
_AUTHORIZATIONS = "mcp_oauth_authorizations"


def _has_table(table: str) -> bool:
    return table in sa.inspect(op.get_bind()).get_table_names()


def _created_at() -> sa.Column:
    return sa.Column(
        "created_at",
        sa.DateTime(timezone=True),
        server_default=sa.text("now()"),
        nullable=False,
    )


def upgrade() -> None:
    if not _has_table(_CLIENTS):
        op.create_table(
            _CLIENTS,
            sa.Column("id", sa.String(length=36), nullable=False),
            sa.Column("organization_id", sa.String(length=36), nullable=False),
            sa.Column("client_id", sa.String(length=64), nullable=False),
            sa.Column("client_secret_hash", sa.String(length=64), nullable=True),
            sa.Column("name", sa.String(length=100), nullable=False),
            sa.Column("redirect_uris", sa.JSON(), nullable=False),
            sa.Column("created_by", sa.String(length=36), nullable=True),
            _created_at(),
            sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("revoked_by", sa.String(length=36), nullable=True),
            sa.ForeignKeyConstraint(
                ["organization_id"], ["organizations.id"], ondelete="CASCADE"
            ),
            sa.ForeignKeyConstraint(["created_by"], ["users.id"], ondelete="SET NULL"),
            sa.ForeignKeyConstraint(["revoked_by"], ["users.id"], ondelete="SET NULL"),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index(
            "ix_mcp_oauth_clients_organization_id", _CLIENTS, ["organization_id"]
        )
        op.create_index(
            "ix_mcp_oauth_clients_client_id", _CLIENTS, ["client_id"], unique=True
        )

    if not _has_table(_GRANTS):
        op.create_table(
            _GRANTS,
            sa.Column("id", sa.String(length=36), nullable=False),
            sa.Column("organization_id", sa.String(length=36), nullable=False),
            sa.Column("client_pk", sa.String(length=36), nullable=False),
            sa.Column("user_id", sa.String(length=36), nullable=False),
            sa.Column("scope", sa.String(length=255), nullable=False),
            sa.Column("resource", sa.String(length=500), nullable=False),
            sa.Column("access_token_hash", sa.String(length=64), nullable=True),
            sa.Column("access_expires_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("refresh_token_hash", sa.String(length=64), nullable=True),
            sa.Column("refresh_expires_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
            _created_at(),
            sa.Column("last_used_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("revoked_by", sa.String(length=36), nullable=True),
            sa.Column("revoked_reason", sa.String(length=32), nullable=True),
            sa.ForeignKeyConstraint(
                ["organization_id"], ["organizations.id"], ondelete="CASCADE"
            ),
            sa.ForeignKeyConstraint(
                ["client_pk"], ["mcp_oauth_clients.id"], ondelete="CASCADE"
            ),
            sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["revoked_by"], ["users.id"], ondelete="SET NULL"),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index(
            "ix_mcp_oauth_grants_organization_id", _GRANTS, ["organization_id"]
        )
        op.create_index("ix_mcp_oauth_grants_client_pk", _GRANTS, ["client_pk"])
        op.create_index("ix_mcp_oauth_grants_user_id", _GRANTS, ["user_id"])

    if not _has_table(_AUTHORIZATIONS):
        op.create_table(
            _AUTHORIZATIONS,
            sa.Column("id", sa.String(length=36), nullable=False),
            sa.Column("organization_id", sa.String(length=36), nullable=False),
            sa.Column("client_pk", sa.String(length=36), nullable=False),
            sa.Column("redirect_uri", sa.Text(), nullable=False),
            sa.Column("scope", sa.String(length=255), nullable=False),
            sa.Column("state", sa.Text(), nullable=True),
            sa.Column("code_challenge", sa.String(length=128), nullable=False),
            sa.Column("resource", sa.String(length=500), nullable=False),
            sa.Column("status", sa.String(length=16), nullable=False),
            sa.Column("user_id", sa.String(length=36), nullable=True),
            sa.Column("code_hash", sa.String(length=64), nullable=True),
            sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("decided_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("consumed_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("grant_id", sa.String(length=36), nullable=True),
            _created_at(),
            sa.ForeignKeyConstraint(
                ["organization_id"], ["organizations.id"], ondelete="CASCADE"
            ),
            sa.ForeignKeyConstraint(
                ["client_pk"], ["mcp_oauth_clients.id"], ondelete="CASCADE"
            ),
            sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(
                ["grant_id"], ["mcp_oauth_grants.id"], ondelete="SET NULL"
            ),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index(
            "ix_mcp_oauth_authorizations_organization_id",
            _AUTHORIZATIONS,
            ["organization_id"],
        )
        op.create_index(
            "ix_mcp_oauth_authorizations_client_pk", _AUTHORIZATIONS, ["client_pk"]
        )
        op.create_index(
            "ix_mcp_oauth_authorizations_code_hash",
            _AUTHORIZATIONS,
            ["code_hash"],
            unique=True,
        )


def downgrade() -> None:
    # Children first: authorizations reference grants, and both reference
    # clients. The tables are dropped whole rather than index by index —
    # MySQL refuses to drop an index a foreign key still needs, and the
    # indexes go with their table anyway.
    for table in (_AUTHORIZATIONS, _GRANTS, _CLIENTS):
        op.execute(f"DROP TABLE IF EXISTS {table}")
