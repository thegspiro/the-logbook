"""History phase 6: articles

New tables:

- ``history_articles``: a written piece, with the same publication and
  revision columns as ``history_events``. ``citations`` is a JSON list of the
  Historian's own references. ``search_text`` is MEDIUMTEXT: it holds the
  plain text of every text block, which can pass TEXT's 64 KB. Research notes
  are encrypted text. ``cover_media_id`` is SET NULL.
- ``history_article_blocks``: the article's body in order, each block either
  sanitized text (MEDIUMTEXT, the same subset and bound as minutes) or an
  archive photo (``media_id``, SET NULL) with a caption and a size. Unique on
  (article, position).
- ``history_article_members``, ``history_article_events``,
  ``history_article_apparatus`` and ``history_article_documents``: what an
  article links to, CASCADE on both sides.

No existing table changes, so no existing row needs settling. Every step is
skipped when its table already exists, so a database ``create_all`` built
first upgrades cleanly (pitfall #26).

Downgrade drops the six tables and every article recorded in them. Take a
database backup (``scripts/backup.sh``) before downgrading past this revision.

Revision ID: 8d4ee6cc92ca
Revises: b6e3d1f47a29
Create Date: 2026-11-23 09:00:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import mysql

revision: str = "8d4ee6cc92ca"
down_revision: Union[str, None] = "b6e3d1f47a29"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# Frozen copies of the enum values at this revision.
_LEVEL = ("draft", "members", "public")
_BLOCK_KIND = ("text", "photo")
_PHOTO_SIZE = ("full", "half")

# Table and key names, as module constants so the migration test can run it
# on prefixed scratch tables in the real database.
ORGANIZATIONS = "organizations"
USERS = "users"
MEMBERS = "historical_members"
MEDIA = "history_media"
DOCUMENTS = "history_documents"
EVENTS = "history_events"
APPARATUS = "history_apparatus"

ARTICLES = "history_articles"
BLOCKS = "history_article_blocks"
ARTICLE_MEMBERS = "history_article_members"
ARTICLE_EVENTS = "history_article_events"
ARTICLE_APPARATUS = "history_article_apparatus"
ARTICLE_DOCUMENTS = "history_article_documents"

UQ_BLOCK_POSITION = "uq_history_article_blocks_position"
IX_ARTICLES_ORG_LEVEL = "ix_history_articles_org_level"
IX_ARTICLES_ORG_UPDATED = "ix_history_articles_org_updated"
IX_ARTICLES_COVER = "ix_history_articles_cover"
IX_BLOCKS_MEDIA = "ix_history_article_blocks_media"
IX_ARTICLE_MEMBERS_MEMBER = "ix_history_article_members_member"
IX_ARTICLE_EVENTS_EVENT = "ix_history_article_events_event"
IX_ARTICLE_APPARATUS_APPARATUS = "ix_history_article_apparatus_apparatus"
IX_ARTICLE_DOCUMENTS_DOCUMENT = "ix_history_article_documents_document"


def _has_table(table: str) -> bool:
    return sa.inspect(op.get_bind()).has_table(table)


def _long_text() -> sa.types.TypeEngine:
    return sa.Text().with_variant(mysql.MEDIUMTEXT(), "mysql")


def _user_fk(name: str) -> sa.Column:
    return sa.Column(
        name,
        sa.String(36),
        sa.ForeignKey(f"{USERS}.id", ondelete="SET NULL"),
        nullable=True,
    )


def _nullable_fk(name: str, target: str) -> sa.Column:
    return sa.Column(
        name,
        sa.String(36),
        sa.ForeignKey(target, ondelete="SET NULL"),
        nullable=True,
    )


def _key(name: str, target: str) -> sa.Column:
    return sa.Column(
        name,
        sa.String(36),
        sa.ForeignKey(target, ondelete="CASCADE"),
        primary_key=True,
    )


def _created_at() -> sa.Column:
    return sa.Column(
        "created_at",
        sa.DateTime(timezone=True),
        nullable=False,
        server_default=sa.func.now(),
    )


def _link_table(table: str, key: str, target: str, index: str) -> None:
    if _has_table(table):
        return
    op.create_table(
        table,
        _key("article_id", f"{ARTICLES}.id"),
        _key(key, target),
        sa.Column("position", sa.Integer(), nullable=False, server_default="0"),
        _created_at(),
    )
    op.create_index(index, table, [key])


def upgrade() -> None:
    if not _has_table(ARTICLES):
        op.create_table(
            ARTICLES,
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column(
                "organization_id",
                sa.String(36),
                sa.ForeignKey(f"{ORGANIZATIONS}.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column("title", sa.String(200), nullable=False),
            sa.Column("subtitle", sa.String(300), nullable=True),
            sa.Column("byline", sa.String(200), nullable=True),
            sa.Column("summary", sa.Text(), nullable=True),
            _nullable_fk("cover_media_id", f"{MEDIA}.id"),
            sa.Column("citations", sa.JSON(), nullable=True),
            sa.Column("search_text", _long_text(), nullable=True),
            sa.Column("research_notes", sa.Text(), nullable=True),
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
            sa.Column(
                "updated_at",
                sa.DateTime(timezone=True),
                nullable=False,
                server_default=sa.func.now(),
            ),
        )
        op.create_index(
            IX_ARTICLES_ORG_LEVEL, ARTICLES, ["organization_id", "publication_level"]
        )
        op.create_index(
            IX_ARTICLES_ORG_UPDATED, ARTICLES, ["organization_id", "updated_at"]
        )
        op.create_index(IX_ARTICLES_COVER, ARTICLES, ["cover_media_id"])

    if not _has_table(BLOCKS):
        op.create_table(
            BLOCKS,
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column(
                "article_id",
                sa.String(36),
                sa.ForeignKey(f"{ARTICLES}.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column("position", sa.Integer(), nullable=False),
            sa.Column(
                "kind", sa.Enum(*_BLOCK_KIND, name="articleblockkind"), nullable=False
            ),
            sa.Column("html", _long_text(), nullable=True),
            _nullable_fk("media_id", f"{MEDIA}.id"),
            sa.Column("caption", sa.String(500), nullable=True),
            sa.Column(
                "size",
                sa.Enum(*_PHOTO_SIZE, name="articlephotosize"),
                nullable=False,
                server_default="full",
            ),
            sa.UniqueConstraint("article_id", "position", name=UQ_BLOCK_POSITION),
        )
        op.create_index(IX_BLOCKS_MEDIA, BLOCKS, ["media_id"])

    _link_table(
        ARTICLE_MEMBERS, "member_id", f"{MEMBERS}.id", IX_ARTICLE_MEMBERS_MEMBER
    )
    _link_table(ARTICLE_EVENTS, "event_id", f"{EVENTS}.id", IX_ARTICLE_EVENTS_EVENT)
    _link_table(
        ARTICLE_APPARATUS,
        "apparatus_id",
        f"{APPARATUS}.id",
        IX_ARTICLE_APPARATUS_APPARATUS,
    )
    _link_table(
        ARTICLE_DOCUMENTS,
        "document_id",
        f"{DOCUMENTS}.document_id",
        IX_ARTICLE_DOCUMENTS_DOCUMENT,
    )


def downgrade() -> None:
    # Children before parents, so no foreign key blocks a drop.
    for table in (
        ARTICLE_DOCUMENTS,
        ARTICLE_APPARATUS,
        ARTICLE_EVENTS,
        ARTICLE_MEMBERS,
        BLOCKS,
        ARTICLES,
    ):
        if _has_table(table):
            op.drop_table(table)
