"""Minutes public copies

Adds what publishing needs to post minutes on the public page and to say what
a republish replaced:

* ``minutes_public_copies`` — the snapshot posted publicly, one row per set of
  minutes, replaced in place, with the version it replaced and whether it has
  been withdrawn or is under correction.
* ``meeting_minutes.published_revision_version`` and ``published_at`` — which
  adopted version the library copy shows and when it was filed.

Nothing is backfilled and nothing becomes public: the public page serves only
rows in the new table, and a department must switch public posting on in its
settings before one is written. Minutes already published to the library have
no recorded version, so their next republish carries no "replaces version"
note rather than a wrong one.

Each step is skipped when its table is not there yet (``create_all`` builds it
from the models, which already declare these columns) or when the change is
already made. The downgrade drops the table and the columns; public copies and
the recorded versions are lost with them, and the minutes themselves and their
library copies are untouched.

Revision ID: 89723c04ae94
Revises: 1117b642643b
Create Date: 2026-10-17 23:05:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "89723c04ae94"
down_revision: Union[str, None] = "1117b642643b"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

TABLE = "minutes_public_copies"
MINUTES = "meeting_minutes"
COLUMNS = ("published_revision_version", "published_at")


def _inspector() -> sa.Inspector:
    return sa.inspect(op.get_bind())


def upgrade() -> None:
    inspector = _inspector()
    tables = set(inspector.get_table_names())

    if MINUTES in tables:
        have = {c["name"] for c in inspector.get_columns(MINUTES)}
        if "published_revision_version" not in have:
            op.add_column(
                MINUTES,
                sa.Column("published_revision_version", sa.Integer(), nullable=True),
            )
        if "published_at" not in have:
            op.add_column(
                MINUTES,
                sa.Column("published_at", sa.DateTime(timezone=True), nullable=True),
            )

    if TABLE in tables or not {MINUTES, "organizations", "users"} <= tables:
        # Present already, or a fresh database where create_all builds it from
        # the models after the tables it points at.
        return

    op.create_table(
        TABLE,
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "organization_id",
            sa.String(36),
            sa.ForeignKey("organizations.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "minutes_id",
            sa.String(36),
            sa.ForeignKey("meeting_minutes.id", ondelete="CASCADE"),
            nullable=False,
            unique=True,
        ),
        sa.Column("title", sa.String(255), nullable=False),
        sa.Column("meeting_type", sa.String(50), nullable=False),
        sa.Column("meeting_date", sa.DateTime(timezone=True), nullable=True),
        sa.Column("content", sa.JSON(), nullable=False),
        sa.Column("revision_version", sa.Integer(), nullable=True),
        sa.Column("posted_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "posted_by",
            sa.String(36),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("replaced_version", sa.Integer(), nullable=True),
        sa.Column("replaced_posted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("under_correction_since", sa.DateTime(timezone=True), nullable=True),
        sa.Column("withdrawn_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "withdrawn_by",
            sa.String(36),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.create_index(
        "ix_minutes_public_copies_organization_id", TABLE, ["organization_id"]
    )
    op.create_index(
        "ix_minutes_public_copies_listing", TABLE, ["organization_id", "withdrawn_at"]
    )


def downgrade() -> None:
    inspector = _inspector()
    tables = set(inspector.get_table_names())

    op.execute(sa.text(f"DROP TABLE IF EXISTS {TABLE}"))

    if MINUTES in tables:
        have = {c["name"] for c in inspector.get_columns(MINUTES)}
        for column in COLUMNS:
            if column in have:
                op.drop_column(MINUTES, column)
