"""Add user_passkeys and webauthn_challenges — passkeys as a second factor.

A member can register up to three passkeys (WebAuthn credentials) and use one
in place of the authenticator-app code after their password or SSO sign-in.
``user_passkeys`` holds each credential's public key, the domain it was
created for, its id (plus a SHA-256 digest of the id that carries the unique
index) and its usage metadata;
``webauthn_challenges`` holds the short-lived single-use challenges the
browser signs.

Both tables are new, so there are no existing rows to settle.

**Reversible.** The downgrade drops both tables. Members whose only second
factor was a passkey are then treated as not enrolled: where MFA is required
they are sent to authenticator-app setup at their next sign-in. Their
recovery codes stay on the user row and keep working.

Revision ID: c616fa1bd492
Revises: c96c193f9db8
Create Date: 2026-10-25 19:43:00.000000
"""

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "c616fa1bd492"
down_revision = "c96c193f9db8"
branch_labels = None
depends_on = None

_PASSKEYS = "user_passkeys"
_CHALLENGES = "webauthn_challenges"


def _has_table(table: str) -> bool:
    return table in sa.inspect(op.get_bind()).get_table_names()


def upgrade() -> None:
    # Idempotent: an installation that already ran ``create_all`` from the
    # models has the tables, and re-creating one would fail the whole upgrade.
    if not _has_table(_PASSKEYS):
        op.create_table(
            _PASSKEYS,
            sa.Column("id", sa.String(length=36), nullable=False),
            sa.Column("user_id", sa.String(length=36), nullable=False),
            sa.Column("organization_id", sa.String(length=36), nullable=False),
            sa.Column("credential_id", sa.Text(), nullable=False),
            sa.Column("credential_id_hash", sa.String(length=64), nullable=False),
            sa.Column("public_key", sa.Text(), nullable=False),
            sa.Column("rp_id", sa.String(length=255), nullable=False),
            sa.Column("sign_count", sa.BigInteger(), nullable=False),
            sa.Column("transports", sa.JSON(), nullable=True),
            sa.Column("aaguid", sa.String(length=36), nullable=True),
            sa.Column("backed_up", sa.Boolean(), nullable=False),
            sa.Column("name", sa.String(length=100), nullable=False),
            sa.Column(
                "created_at",
                sa.DateTime(timezone=True),
                server_default=sa.text("now()"),
                nullable=False,
            ),
            sa.Column("last_used_at", sa.DateTime(timezone=True), nullable=True),
            sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(
                ["organization_id"], ["organizations.id"], ondelete="CASCADE"
            ),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index("ix_user_passkeys_user_id", _PASSKEYS, ["user_id"])
        op.create_index(
            "ix_user_passkeys_organization_id", _PASSKEYS, ["organization_id"]
        )
        op.create_index(
            "ix_user_passkeys_credential_id_hash",
            _PASSKEYS,
            ["credential_id_hash"],
            unique=True,
        )

    if not _has_table(_CHALLENGES):
        op.create_table(
            _CHALLENGES,
            sa.Column("id", sa.String(length=36), nullable=False),
            sa.Column("user_id", sa.String(length=36), nullable=False),
            sa.Column("purpose", sa.String(length=20), nullable=False),
            sa.Column("challenge", sa.String(length=128), nullable=False),
            sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column(
                "created_at",
                sa.DateTime(timezone=True),
                server_default=sa.text("now()"),
                nullable=False,
            ),
            sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index("ix_webauthn_challenges_user_id", _CHALLENGES, ["user_id"])


def downgrade() -> None:
    if _has_table(_CHALLENGES):
        op.drop_index("ix_webauthn_challenges_user_id", table_name=_CHALLENGES)
        op.drop_table(_CHALLENGES)
    if _has_table(_PASSKEYS):
        op.drop_index("ix_user_passkeys_credential_id_hash", table_name=_PASSKEYS)
        op.drop_index("ix_user_passkeys_organization_id", table_name=_PASSKEYS)
        op.drop_index("ix_user_passkeys_user_id", table_name=_PASSKEYS)
        op.drop_table(_PASSKEYS)
