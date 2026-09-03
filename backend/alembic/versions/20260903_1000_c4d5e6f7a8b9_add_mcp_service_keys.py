"""Add mcp_service_keys — the organization credential behind the Claude MCP add-on.

The MCP endpoint is an opt-in integration, off by default. When a department
turns it on, an administrator holding ``integrations.mcp_keys`` mints one
service key; this table holds that key's SHA-256 digest, its display prefix,
its optional expiry and the revocation/creation audit columns. The plaintext
key is never stored.

**Reversible.** The downgrade drops the table. Any MCP client configured
with a key from it stops authenticating, which is the correct consequence of
removing the feature; nothing else references the table.

Revision ID: c4d5e6f7a8b9
Revises: a8c4d1e2f3b5
Create Date: 2026-09-03 10:00:00.000000
"""

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "c4d5e6f7a8b9"
down_revision = "a8c4d1e2f3b5"
branch_labels = None
depends_on = None

_TABLE = "mcp_service_keys"


def _has_table(table: str) -> bool:
    return table in sa.inspect(op.get_bind()).get_table_names()


def upgrade() -> None:
    # Idempotent: an installation that already ran ``create_all`` from the
    # models has the table, and re-creating it would fail the whole upgrade.
    if _has_table(_TABLE):
        return

    op.create_table(
        _TABLE,
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("organization_id", sa.String(length=36), nullable=False),
        sa.Column("key_hash", sa.String(length=64), nullable=False),
        sa.Column("key_prefix", sa.String(length=24), nullable=False),
        sa.Column("name", sa.String(length=100), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("revoked_by", sa.String(length=36), nullable=True),
        sa.Column("created_by", sa.String(length=36), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["organization_id"], ["organizations.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(["revoked_by"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_mcp_service_keys_organization_id", _TABLE, ["organization_id"])
    op.create_index("ix_mcp_service_keys_key_hash", _TABLE, ["key_hash"], unique=True)


def downgrade() -> None:
    if not _has_table(_TABLE):
        return
    op.drop_index("ix_mcp_service_keys_key_hash", table_name=_TABLE)
    op.drop_index("ix_mcp_service_keys_organization_id", table_name=_TABLE)
    op.drop_table(_TABLE)
