"""History phase 4: documents

New tables only:

- ``history_document_types``: the managed list of document types.
- ``history_documents``: the archive's catalogue of a document, one-to-one
  with its ``documents`` row (``document_id`` is the primary key), with the
  same publication and revision columns as ``history_media``. Research notes
  are encrypted text; the transcription and the PDF's text are plain
  MEDIUMTEXT because both are searched.
- ``history_document_files``: the stripped copy readers open and its
  preview, one stored file per row.
- ``history_document_tags``: people a document concerns.
- ``history_album_documents``: a document's place in an album, beside the
  album's photos.

No existing row is touched, so nothing is backfilled. Every step is skipped
when its table already exists, so a database ``create_all`` built first
upgrades cleanly.

Downgrade drops the five tables and everything recorded in them. The
documents' originals stay in the Documents module's History folder; the
stripped copies and previews stay on the uploads volume (or the
department's own store) under ``<org>/history-media/``. Take a database and
uploads backup (``scripts/backup.sh``) before downgrading past this revision.

Revision ID: 4d8e2b6f1c93
Revises: 7a3c9e1d5b42
Create Date: 2026-11-14 09:00:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import mysql

revision: str = "4d8e2b6f1c93"
down_revision: Union[str, None] = "7a3c9e1d5b42"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# Frozen copies of the enum values at this revision.
_KIND = ("pdf", "image")
_ROLE = ("original", "display", "thumbnail")
_PRECISION = ("day", "month", "year")
_LEVEL = ("draft", "members", "public")

# Table and key names, as module constants so the migration test can run it
# on prefixed scratch tables in the real database.
ORGANIZATIONS = "organizations"
USERS = "users"
DOCUMENTS = "documents"
MEMBERS = "historical_members"
SOURCES = "history_sources"
ALBUMS = "history_albums"
TYPES = "history_document_types"
HISTORY_DOCUMENTS = "history_documents"
FILES = "history_document_files"
TAGS = "history_document_tags"
ALBUM_DOCUMENTS = "history_album_documents"

UQ_TYPE_KEY = "uq_history_document_type_key"
UQ_FILE_ROLE = "uq_history_document_file_role"
IX_DOCS_ORG_LEVEL = "ix_history_documents_org_level"
IX_DOCS_ORG_TYPE = "ix_history_documents_org_type"
IX_DOCS_ORG_DATE = "ix_history_documents_org_date"
IX_DOCS_SOURCE = "ix_history_documents_source"
IX_TAGS_MEMBER = "ix_history_document_tags_member"
IX_ALBUM_DOCUMENTS_DOCUMENT = "ix_history_album_documents_document"


def _long_text() -> sa.types.TypeEngine:
    # Up to 2 MB of a PDF's text: past TEXT's 64 KB ceiling.
    return sa.Text().with_variant(mysql.MEDIUMTEXT(), "mysql")


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


def _document_fk(name: str, primary_key: bool = False) -> sa.Column:
    return sa.Column(
        name,
        sa.String(36),
        sa.ForeignKey(f"{HISTORY_DOCUMENTS}.document_id", ondelete="CASCADE"),
        primary_key=primary_key,
        nullable=False,
    )


def upgrade() -> None:
    if not _has_table(TYPES):
        op.create_table(
            TYPES,
            sa.Column("id", sa.String(36), primary_key=True),
            _org(),
            sa.Column("name", sa.String(150), nullable=False),
            sa.Column("name_key", sa.String(150), nullable=False),
            sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
            _flag("is_retired"),
            _user_fk("created_by"),
            _created_at(),
            _updated_at(),
            sa.UniqueConstraint("organization_id", "name_key", name=UQ_TYPE_KEY),
        )

    if not _has_table(HISTORY_DOCUMENTS):
        op.create_table(
            HISTORY_DOCUMENTS,
            sa.Column(
                "document_id",
                sa.String(36),
                sa.ForeignKey(f"{DOCUMENTS}.id", ondelete="CASCADE"),
                primary_key=True,
            ),
            _org(),
            sa.Column("kind", sa.Enum(*_KIND, name="documentkind"), nullable=False),
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
            sa.Column(
                "document_type_id",
                sa.String(36),
                sa.ForeignKey(f"{TYPES}.id", ondelete="SET NULL"),
                nullable=True,
            ),
            sa.Column("author", sa.String(255), nullable=True),
            sa.Column("recipient", sa.String(255), nullable=True),
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
            sa.Column("transcription", _long_text(), nullable=True),
            sa.Column("extracted_text", _long_text(), nullable=True),
            _flag("text_truncated"),
            sa.Column("page_count", sa.Integer(), nullable=True),
            sa.Column("width", sa.Integer(), nullable=True),
            sa.Column("height", sa.Integer(), nullable=True),
            sa.Column("original_filename", sa.String(255), nullable=False),
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
            IX_DOCS_ORG_LEVEL,
            HISTORY_DOCUMENTS,
            ["organization_id", "publication_level"],
        )
        op.create_index(
            IX_DOCS_ORG_TYPE, HISTORY_DOCUMENTS, ["organization_id", "document_type_id"]
        )
        op.create_index(
            IX_DOCS_ORG_DATE, HISTORY_DOCUMENTS, ["organization_id", "taken_date"]
        )
        op.create_index(IX_DOCS_SOURCE, HISTORY_DOCUMENTS, ["source_id"])

    if not _has_table(FILES):
        op.create_table(
            FILES,
            sa.Column("id", sa.String(36), primary_key=True),
            _document_fk("document_id"),
            sa.Column("role", sa.Enum(*_ROLE, name="mediafilerole"), nullable=False),
            sa.Column("file_path", sa.String(500), nullable=False),
            sa.Column("mime_type", sa.String(100), nullable=False),
            sa.Column("size_bytes", sa.Integer(), nullable=False),
            sa.Column("sha256", sa.String(64), nullable=False),
            _created_at(),
            sa.UniqueConstraint("document_id", "role", name=UQ_FILE_ROLE),
        )

    if not _has_table(TAGS):
        op.create_table(
            TAGS,
            _document_fk("document_id", primary_key=True),
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

    if not _has_table(ALBUM_DOCUMENTS):
        op.create_table(
            ALBUM_DOCUMENTS,
            sa.Column(
                "album_id",
                sa.String(36),
                sa.ForeignKey(f"{ALBUMS}.id", ondelete="CASCADE"),
                primary_key=True,
            ),
            _document_fk("document_id", primary_key=True),
            sa.Column("position", sa.Integer(), nullable=False, server_default="0"),
            _created_at(),
        )
        op.create_index(IX_ALBUM_DOCUMENTS_DOCUMENT, ALBUM_DOCUMENTS, ["document_id"])


def downgrade() -> None:
    # Children before parents, so no foreign key blocks a drop.
    for table in (ALBUM_DOCUMENTS, TAGS, FILES, HISTORY_DOCUMENTS, TYPES):
        if _has_table(table):
            op.drop_table(table)
