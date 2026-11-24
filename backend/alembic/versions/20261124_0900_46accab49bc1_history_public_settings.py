"""History phase 7: what the department's website may show

New table ``history_public_settings``, one row per department: a switch for
each kind of History record the public portal may serve (all off by default),
the "Today in history" widget's style options, and the SHA-256 of the widget's
secret link (the secret itself is never stored).

No existing table changes, so no existing row needs settling, and a department
without a row reads as every switch off. The step is skipped when the table
already exists, so a database ``create_all`` built first upgrades cleanly
(pitfall #26).

Downgrade drops the table: every switch returns to off and the widget link
stops working.

Revision ID: 46accab49bc1
Revises: 8d4ee6cc92ca
Create Date: 2026-11-24 09:00:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "46accab49bc1"
down_revision: Union[str, None] = "8d4ee6cc92ca"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# A frozen copy of the enum's values at this revision.
_THEME = ("auto", "light", "dark")

# Names as module constants, so the migration test can run it on prefixed
# scratch tables in the real database.
ORGANIZATIONS = "organizations"
USERS = "users"
SETTINGS = "history_public_settings"

#: One switch per kind of record, in the order they are added.
SWITCHES = (
    "show_people",
    "show_honor_roll",
    "show_photos",
    "show_documents",
    "show_events",
    "show_apparatus",
    "show_articles",
    "show_timeline",
    "show_today",
)


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
        sa.Column("widget_token_hash", sa.String(64), nullable=True, unique=True),
        sa.Column("widget_token_created_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "widget_theme",
            sa.Enum(*_THEME, name="publicwidgettheme"),
            nullable=False,
            server_default="auto",
        ),
        sa.Column(
            "widget_show_branding", sa.Boolean(), nullable=False, server_default="1"
        ),
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
