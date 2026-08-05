"""Widen documents.content_html and organizations.logo to LONGTEXT

Both columns were created as LONGTEXT by migration (20260213_0800 for
``content_html``, 20260209_0600 for ``logo``) but declared narrower in the
models — ``TEXT`` (64 KB) and ``MEDIUMTEXT`` (16 MB) respectively.

Because a fresh install builds its schema from the models via
``_fast_path_init``'s ``create_all()`` rather than by replaying this chain,
every database created that way got the *narrow* column, and the migrations
above never ran against it. A published set of minutes over 64 KB therefore
fails to save on a fresh install while working fine on an older one.

The models are corrected alongside this revision, which fixes future installs.
This revision fixes the databases that already exist. On a chain-built database
both columns are already LONGTEXT and the MODIFY is a no-op.

Revision ID: 20260805_0010
Revises: 20260805_0002
Create Date: 2026-08-05 00:00:00.000000

Numbered 0010 but sequenced before 0003: this revision and 20260805_0011 were
authored on a branch off 20260802_0010 that claimed ids 0001 and 0002, which
the course-cohort branch had already taken. Renumbering these two — rather
than the seven downstream of them — kept every id cited in the wiki, the
CHANGELOG and docs/ pointing at the revision it was written about. The
position in the chain is the one the DDL was written for; only the label moved.

"""

import sqlalchemy as sa
from sqlalchemy.dialects import mysql

from alembic import op

# revision identifiers, used by Alembic.
revision = "20260805_0010"
down_revision = "20260805_0002"
branch_labels = None
depends_on = None


# (table, column, nullable) — both are nullable free-text/base64 payloads.
_COLUMNS = [
    ("documents", "content_html", True),
    ("organizations", "logo", True),
]


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    for table, column, nullable in _COLUMNS:
        if not inspector.has_table(table):
            continue
        existing = {c["name"] for c in inspector.get_columns(table)}
        if column not in existing:
            continue
        op.alter_column(
            table,
            column,
            existing_type=sa.Text(),
            type_=mysql.LONGTEXT(),
            existing_nullable=nullable,
        )


def downgrade() -> None:
    # Deliberately not narrowing on the way down: shrinking a LONGTEXT that
    # may hold >64 KB of document HTML would truncate real content. The wider
    # column is harmless to leave in place.
    pass
