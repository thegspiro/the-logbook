"""History phase 3: photos and media

New tables only:

- ``history_sources``: the managed source / donor list.
- ``history_media``: a photo, audio recording or video with its catalogue and
  the same publication and revision columns as ``historical_members``. The
  research notes are encrypted text.
- ``history_media_files``: one stored file per row (original, viewing copy,
  thumbnail), so each stored path sits in a single column the storage tools
  can rewrite.
- ``history_media_tags``: who is shown or heard in an item.
- ``history_albums`` / ``history_album_items``: named, ordered groups.

No existing row is touched, so nothing is backfilled. Every step is skipped
when its table already exists, so a database ``create_all`` built first
upgrades cleanly.

Downgrade drops the six tables and everything recorded in them. The stored
files themselves stay on the uploads volume (or the department's own store)
under ``<org>/history-media/``; take a database and uploads backup
(``scripts/backup.sh``) before downgrading past this revision.

Revision ID: 7a3c9e1d5b42
Revises: 5e2b9c7d1a40
Create Date: 2026-11-13 16:40:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "7a3c9e1d5b42"
down_revision: Union[str, None] = "5e2b9c7d1a40"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# Frozen copies of the enum values at this revision.
_KIND = ("photo", "audio", "video")
_ROLE = ("original", "display", "thumbnail")
_ALBUM_LEVEL = ("draft", "members")
_PRECISION = ("day", "month", "year")
_LEVEL = ("draft", "members", "public")

# Table and key names, as module constants so the migration test can run it
# on prefixed scratch tables in the real database.
ORGANIZATIONS = "organizations"
USERS = "users"
MEMBERS = "historical_members"
SOURCES = "history_sources"
MEDIA = "history_media"
FILES = "history_media_files"
TAGS = "history_media_tags"
ALBUMS = "history_albums"
ALBUM_ITEMS = "history_album_items"

UQ_SOURCE_KEY = "uq_history_source_key"
UQ_FILE_ROLE = "uq_history_media_file_role"
IX_MEDIA_ORG_LEVEL = "ix_history_media_org_level"
IX_MEDIA_ORG_KIND = "ix_history_media_org_kind"
IX_MEDIA_ORG_DATE = "ix_history_media_org_date"
IX_MEDIA_SOURCE = "ix_history_media_source"
IX_TAGS_MEMBER = "ix_history_media_tags_member"
IX_ALBUMS_ORG_LEVEL = "ix_history_albums_org_level"
IX_ALBUM_ITEMS_MEDIA = "ix_history_album_items_media"


def _has_table(table: str) -> bool:
    return sa.inspect(op.get_bind()).has_table(table)


def _org() -> sa.Column:
    return sa.Column(
        "organization_id",
        sa.String(36),
        sa.ForeignKey(f"{ORGANIZATIONS}.id", ondelete="CASCADE"),
        nullable=False,
    )


def _user_fk(name: str) -> sa.Column:
    return sa.Column(
        name,
        sa.String(36),
        sa.ForeignKey(f"{USERS}.id", ondelete="SET NULL"),
        nullable=True,
    )


def _created_at() -> sa.Column:
    return sa.Column(
        "created_at",
        sa.DateTime(timezone=True),
        nullable=False,
        server_default=sa.func.now(),
    )


def _updated_at() -> sa.Column:
    return sa.Column(
        "updated_at",
        sa.DateTime(timezone=True),
        nullable=False,
        server_default=sa.func.now(),
    )


def _flag(name: str) -> sa.Column:
    return sa.Column(name, sa.Boolean(), nullable=False, server_default="0")


def upgrade() -> None:
    if not _has_table(SOURCES):
        op.create_table(
            SOURCES,
            sa.Column("id", sa.String(36), primary_key=True),
            _org(),
            sa.Column("name", sa.String(150), nullable=False),
            sa.Column("name_key", sa.String(150), nullable=False),
            sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
            _flag("is_retired"),
            _user_fk("created_by"),
            _created_at(),
            _updated_at(),
            sa.UniqueConstraint("organization_id", "name_key", name=UQ_SOURCE_KEY),
        )

    if not _has_table(MEDIA):
        op.create_table(
            MEDIA,
            sa.Column("id", sa.String(36), primary_key=True),
            _org(),
            sa.Column("kind", sa.Enum(*_KIND, name="mediakind"), nullable=False),
            sa.Column("title", sa.String(200), nullable=False),
            sa.Column("description", sa.Text(), nullable=True),
            sa.Column("taken_date", sa.Date(), nullable=True),
            sa.Column(
                "taken_date_precision",
                sa.Enum(*_PRECISION, name="dateprecision"),
                nullable=False,
                server_default="year",
            ),
            _flag("taken_date_circa"),
            sa.Column("place", sa.String(255), nullable=True),
            sa.Column("creator", sa.String(255), nullable=True),
            sa.Column(
                "source_id",
                sa.String(36),
                sa.ForeignKey(f"{SOURCES}.id", ondelete="SET NULL"),
                nullable=True,
            ),
            sa.Column("rights_note", sa.Text(), nullable=True),
            sa.Column("accession_number", sa.String(100), nullable=True),
            sa.Column("original_location", sa.String(255), nullable=True),
            # Encrypted text.
            sa.Column("research_notes", sa.Text(), nullable=True),
            sa.Column("original_filename", sa.String(255), nullable=False),
            sa.Column("width", sa.Integer(), nullable=True),
            sa.Column("height", sa.Integer(), nullable=True),
            sa.Column("batch_id", sa.String(36), nullable=True),
            sa.Column(
                "publication_level",
                sa.Enum(*_LEVEL, name="publicationlevel"),
                nullable=False,
                server_default="draft",
            ),
            sa.Column("published_at", sa.DateTime(timezone=True), nullable=True),
            _user_fk("published_by"),
            sa.Column("public_snapshot", sa.JSON(), nullable=True),
            sa.Column("public_revision_number", sa.Integer(), nullable=True),
            sa.Column(
                "substantial_revision_number",
                sa.Integer(),
                nullable=False,
                server_default="1",
            ),
            sa.Column(
                "revision_number", sa.Integer(), nullable=False, server_default="1"
            ),
            _user_fk("created_by"),
            _user_fk("updated_by"),
            _created_at(),
            _updated_at(),
        )
        op.create_index(
            IX_MEDIA_ORG_LEVEL, MEDIA, ["organization_id", "publication_level"]
        )
        op.create_index(IX_MEDIA_ORG_KIND, MEDIA, ["organization_id", "kind"])
        op.create_index(IX_MEDIA_ORG_DATE, MEDIA, ["organization_id", "taken_date"])
        op.create_index(IX_MEDIA_SOURCE, MEDIA, ["source_id"])

    if not _has_table(FILES):
        op.create_table(
            FILES,
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column(
                "media_id",
                sa.String(36),
                sa.ForeignKey(f"{MEDIA}.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column("role", sa.Enum(*_ROLE, name="mediafilerole"), nullable=False),
            sa.Column("file_path", sa.String(500), nullable=False),
            sa.Column("mime_type", sa.String(100), nullable=False),
            sa.Column("size_bytes", sa.Integer(), nullable=False),
            sa.Column("sha256", sa.String(64), nullable=False),
            _created_at(),
            sa.UniqueConstraint("media_id", "role", name=UQ_FILE_ROLE),
        )

    if not _has_table(TAGS):
        op.create_table(
            TAGS,
            sa.Column(
                "media_id",
                sa.String(36),
                sa.ForeignKey(f"{MEDIA}.id", ondelete="CASCADE"),
                primary_key=True,
            ),
            sa.Column(
                "member_id",
                sa.String(36),
                sa.ForeignKey(f"{MEMBERS}.id", ondelete="CASCADE"),
                primary_key=True,
            ),
            _user_fk("created_by"),
            _created_at(),
        )
        op.create_index(IX_TAGS_MEMBER, TAGS, ["member_id"])

    if not _has_table(ALBUMS):
        op.create_table(
            ALBUMS,
            sa.Column("id", sa.String(36), primary_key=True),
            _org(),
            sa.Column("name", sa.String(200), nullable=False),
            sa.Column("description", sa.Text(), nullable=True),
            sa.Column(
                "cover_media_id",
                sa.String(36),
                sa.ForeignKey(f"{MEDIA}.id", ondelete="SET NULL"),
                nullable=True,
            ),
            sa.Column(
                "level",
                sa.Enum(*_ALBUM_LEVEL, name="albumlevel"),
                nullable=False,
                server_default="draft",
            ),
            sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
            _user_fk("created_by"),
            _created_at(),
            _updated_at(),
        )
        op.create_index(IX_ALBUMS_ORG_LEVEL, ALBUMS, ["organization_id", "level"])

    if not _has_table(ALBUM_ITEMS):
        op.create_table(
            ALBUM_ITEMS,
            sa.Column(
                "album_id",
                sa.String(36),
                sa.ForeignKey(f"{ALBUMS}.id", ondelete="CASCADE"),
                primary_key=True,
            ),
            sa.Column(
                "media_id",
                sa.String(36),
                sa.ForeignKey(f"{MEDIA}.id", ondelete="CASCADE"),
                primary_key=True,
            ),
            sa.Column("position", sa.Integer(), nullable=False, server_default="0"),
            _created_at(),
        )
        op.create_index(IX_ALBUM_ITEMS_MEDIA, ALBUM_ITEMS, ["media_id"])


def downgrade() -> None:
    # Children before parents, so no foreign key blocks a drop.
    for table in (ALBUM_ITEMS, ALBUMS, TAGS, FILES, MEDIA, SOURCES):
        if _has_table(table):
            op.drop_table(table)
