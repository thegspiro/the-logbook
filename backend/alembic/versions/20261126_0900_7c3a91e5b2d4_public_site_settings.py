"""The department's public website: its settings

New table ``public_site_settings``, one row per department: whether the
website is on, which look it uses, its text, and a switch for each page and
each contact detail. Everything defaults to off.

No existing table changes, so no existing row needs settling, and a department
without a row reads as a website that is switched off. The step is skipped
when the table already exists, so a database ``create_all`` built first
upgrades cleanly (pitfall #26).

Downgrade drops the table: the website stops answering and its text is lost.

Revision ID: 7c3a91e5b2d4
Revises: e9cf8ab7e4e4
Create Date: 2026-11-26 09:00:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "7c3a91e5b2d4"
down_revision: Union[str, None] = "e9cf8ab7e4e4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# Names as module constants, so the migration test can run it on prefixed
# scratch tables in the real database.
ORGANIZATIONS = "organizations"
USERS = "users"
SETTINGS = "public_site_settings"

#: Every on/off column, all off until somebody turns one on.
SWITCHES = (
    "enabled",
    "show_about",
    "show_contact",
    "show_phone",
    "show_email",
    "show_address",
    "show_member_login",
)

# A frozen copy of the model's default at this revision.
_DEFAULT_THEME = "classic"


def _has_table(table: str) -> bool:
    return sa.inspect(op.get_bind()).has_table(table)


def upgrade() -> None:
    if _has_table(SETTINGS):
        return
    op.create_table(
        SETTINGS,
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "organization_id",
            sa.String(36),
            sa.ForeignKey(f"{ORGANIZATIONS}.id", ondelete="CASCADE"),
            nullable=False,
            unique=True,
        ),
        *(
            sa.Column(name, sa.Boolean(), nullable=False, server_default="0")
            for name in SWITCHES
        ),
        sa.Column(
            "theme", sa.String(20), nullable=False, server_default=_DEFAULT_THEME
        ),
        sa.Column("tagline", sa.String(200), nullable=True),
        sa.Column("welcome_text", sa.Text(), nullable=True),
        sa.Column("about_text", sa.Text(), nullable=True),
        sa.Column("emergency_notice", sa.String(200), nullable=True),
        sa.Column(
            "updated_by",
            sa.String(36),
            sa.ForeignKey(f"{USERS}.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )


def downgrade() -> None:
    if _has_table(SETTINGS):
        op.drop_table(SETTINGS)
