"""Google Workspace account provisioning records

Revision ID: 61dfbcc23cba
Revises: c903fc771081
Create Date: 2026-10-15 14:00:00.000000

Adds ``google_account_provisions``: one row per member The Logbook tried to
give a Google Workspace account when they were converted from an applicant —
the account's address, whether it was created, linked to an existing account
or failed, whether the member has been sent its temporary password, and the
suspension The Logbook applies when the member is dropped or deleted.

Purely additive. Nothing is backfilled: members converted before this revision
were never given an account by The Logbook, and the absence of a row is how
that reads.

**Why each step is guarded.** ``users`` and ``organizations`` exist on every
installation that has run its first migration, but the table may already exist
when ``create_all`` (or ``scripts/repair_schema.py``) built it from the model
before Alembic reached this revision (CLAUDE.md pitfall #26). Constraint and
index names are spelled out exactly as the model's naming convention produces
them, so either path yields the same schema.

**Downgrade** drops the table. The Google accounts themselves are untouched —
they live in Google — but which members The Logbook created them for, and any
pending retries, are lost.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "61dfbcc23cba"
down_revision: Union[str, None] = "c903fc771081"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

TABLE = "google_account_provisions"
ORGANIZATIONS = "organizations"
USERS = "users"

FK_ORGANIZATION = "fk_google_account_provisions_organization_id_organizations"
FK_USER = "fk_google_account_provisions_user_id_users"
FK_CREATED_BY = "fk_google_account_provisions_created_by_users"
IX_USER = "ix_google_account_provisions_user"
IX_ORGANIZATION = "ix_google_account_provisions_org"


def _has_table(table: str) -> bool:
    return table in sa.inspect(op.get_bind()).get_table_names()


def upgrade() -> None:
    if _has_table(TABLE) or not (_has_table(ORGANIZATIONS) and _has_table(USERS)):
        return
    op.create_table(
        TABLE,
        sa.Column("id", sa.String(36), nullable=False),
        sa.Column("organization_id", sa.String(36), nullable=False),
        sa.Column("user_id", sa.String(36), nullable=False),
        sa.Column("primary_email", sa.String(255), nullable=False),
        sa.Column("status", sa.String(20), nullable=False),
        sa.Column("google_user_id", sa.String(64), nullable=True),
        sa.Column("credentials_sent", sa.Boolean(), nullable=False, server_default="0"),
        sa.Column("pending_groups", sa.JSON(), nullable=True),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.Column("attempts", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("last_attempt_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "suspension_wanted", sa.Boolean(), nullable=False, server_default="0"
        ),
        sa.Column(
            "suspension_settled", sa.Boolean(), nullable=False, server_default="1"
        ),
        sa.Column(
            "suspended_by_logbook", sa.Boolean(), nullable=False, server_default="0"
        ),
        sa.Column("suspended_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("suspension_error", sa.Text(), nullable=True),
        sa.Column("created_by", sa.String(36), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=True,
            server_default=sa.func.now(),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=True,
            server_default=sa.func.now(),
        ),
        sa.PrimaryKeyConstraint("id", name=f"pk_{TABLE}"),
        sa.ForeignKeyConstraint(
            ["organization_id"],
            [f"{ORGANIZATIONS}.id"],
            name=FK_ORGANIZATION,
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["user_id"], [f"{USERS}.id"], name=FK_USER, ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["created_by"], [f"{USERS}.id"], name=FK_CREATED_BY, ondelete="SET NULL"
        ),
    )
    op.create_index(IX_USER, TABLE, ["user_id"], unique=True)
    op.create_index(IX_ORGANIZATION, TABLE, ["organization_id"])


def downgrade() -> None:
    op.execute(f"DROP TABLE IF EXISTS `{TABLE}`")
