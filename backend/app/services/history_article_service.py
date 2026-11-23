"""
History articles: a station's history, a past chief's profile, the story of a
fire, written from the records the archive already holds.

An article's body is an ordered list of blocks. A text block is the minutes'
HTML subset, sanitized on every write (``app/utils/rich_text.py``); a photo
block names an archive photo by id, with its own caption. A photo is never an
``<img>`` in the HTML: referenced by id, it is checked against each reader on
every view and every export, and the sanitizer's allowlist stays as it is.

What a reader sees is what they could reach anyway: a photo block, cover,
person, event, apparatus or document still a draft is left out of a member's
view; a public article's public copy keeps only what is itself public, and an
article cannot be sent for public clearance while it shows a photo that is not
public (owner-approved spec, 2026-11-22).

Every query filters ``organization_id``; every client-sent id is resolved
inside the caller's department before it is stored (CLAUDE.md pitfall #14).
"""

import copy
from typing import Any, Iterable, Optional

from sqlalchemy import delete, exists, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.history import (
    ArticleBlockKind,
    ArticlePhotoSize,
    HistoricalMember,
    HistoryArticle,
    HistoryArticleApparatus,
    HistoryArticleBlock,
    HistoryArticleDocument,
    HistoryArticleEvent,
    HistoryArticleMember,
    HistoryDocument,
    HistoryEvent,
    HistoryMedia,
    MediaKind,
    PublicationLevel,
    RevisionKind,
)
from app.services.history_document_service import HistoryDocumentService
from app.services.history_event_service import HistoryEventService
from app.services.history_media_service import HistoryMediaService
from app.services.history_records import (
    READABLE_BY_MEMBERS,
    PublishedRecordService,
    apparatus_tag_views,
    can_read_record,
    validated_apparatus_ids,
)
from app.services.history_service import Viewer, display_name
from app.utils.model_updates import apply_updates
from app.utils.rich_text import MAX_HTML_LENGTH, html_to_text, sanitize_html
from app.utils.sql_search import LIKE_ESCAPE_CHAR, like_pattern

RECORD_ARTICLE = "article"

CATALOGUE_FIELDS = (
    "title",
    "subtitle",
    "byline",
    "summary",
    "cover_media_id",
    "citations",
    "research_notes",
)

#: Research notes are the Historian's own; everything else a reader sees.
SUBSTANTIAL_FIELDS = frozenset(CATALOGUE_FIELDS) - {"research_notes"}

_TEXT_FIELDS = ("title", "subtitle", "byline", "summary", "research_notes")

#: The link sets an article write may replace, as the service names them.
LINK_KEYS = ("member_ids", "event_ids", "apparatus_ids", "document_ids")

MAX_BLOCKS = 200
MAX_CITATIONS = 100
CITATION_MAX = 500
CAPTION_MAX = 500
#: Plain text kept for search. 200 full text blocks could run past MEDIUMTEXT;
#: an article that long is still found by its first million characters.
SEARCH_TEXT_MAX = 1_000_000

_SEARCHED = (
    HistoryArticle.title,
    HistoryArticle.subtitle,
    HistoryArticle.summary,
    HistoryArticle.search_text,
)


def _enum_value(value: Any) -> Any:
    return getattr(value, "value", value)


def _clean(values: dict[str, Any]) -> dict[str, Any]:
    cleaned = dict(values)
    for field in _TEXT_FIELDS:
        if field in cleaned and isinstance(cleaned[field], str):
            cleaned[field] = cleaned[field].strip() or None
    if "citations" in cleaned:
        cleaned["citations"] = _clean_citations(cleaned["citations"])
    return cleaned


def _clean_citations(values: Optional[Iterable[Any]]) -> Optional[list[str]]:
    kept = [str(v).strip() for v in (values or []) if str(v or "").strip()]
    if len(kept) > MAX_CITATIONS:
        raise ValueError(f"An article can list at most {MAX_CITATIONS} references")
    if any(len(v) > CITATION_MAX for v in kept):
        raise ValueError(f"A reference can be at most {CITATION_MAX} characters")
    return kept or None


def search_text_of(item: HistoryArticle) -> str:
    """The plain words of an article for its search column: title, subtitle,
    summary, every text block and every caption."""
    parts: list[str] = [item.title or "", item.subtitle or "", item.summary or ""]
    for block in item.blocks:
        if block.kind == ArticleBlockKind.TEXT:
            parts.append(html_to_text(block.html))
        elif block.caption:
            parts.append(block.caption)
    return "\n".join(p for p in parts if p)[:SEARCH_TEXT_MAX]


class HistoryArticleService(PublishedRecordService[HistoryArticle]):
    record_type = RECORD_ARTICLE
    noun = "article"

    def __init__(self, db: AsyncSession):
        super().__init__(db)
        self.media = HistoryMediaService(db)
        self.documents = HistoryDocumentService(db)
        self.events = HistoryEventService(db)

    # ------------------------------------------------------------------
    # Reads
    # ------------------------------------------------------------------

    @staticmethod
    def _options():
        return (
            selectinload(HistoryArticle.cover_media).selectinload(HistoryMedia.files),
            selectinload(HistoryArticle.blocks)
            .selectinload(HistoryArticleBlock.media)
            .selectinload(HistoryMedia.files),
            selectinload(HistoryArticle.members).selectinload(
                HistoryArticleMember.member
            ),
            selectinload(HistoryArticle.event_links)
            .selectinload(HistoryArticleEvent.event)
            .selectinload(HistoryEvent.event_type),
            selectinload(HistoryArticle.event_links)
            .selectinload(HistoryArticleEvent.event)
            .selectinload(HistoryEvent.station),
            selectinload(HistoryArticle.apparatus_links).selectinload(
                HistoryArticleApparatus.apparatus
            ),
            selectinload(HistoryArticle.document_links)
            .selectinload(HistoryArticleDocument.history_document)
            .selectinload(HistoryDocument.files),
            selectinload(HistoryArticle.document_links)
            .selectinload(HistoryArticleDocument.history_document)
            .selectinload(HistoryDocument.document_type),
        )

    async def get_article(
        self, organization_id: str, article_id: str
    ) -> Optional[HistoryArticle]:
        return await self.db.scalar(
            select(HistoryArticle)
            .options(*self._options())
            .where(
                HistoryArticle.id == str(article_id),
                HistoryArticle.organization_id == str(organization_id),
            )
            .execution_options(populate_existing=True)
        )

    async def _reload(self, item: HistoryArticle) -> HistoryArticle:
        reloaded = await self.get_article(item.organization_id, item.id)
        if reloaded is None:
            raise ValueError("This article could not be read back")
        return reloaded

    @staticmethod
    def can_read(viewer: Viewer, item: HistoryArticle) -> bool:
        return can_read_record(viewer.can_view_archive, item)

    async def get_readable_article(
        self, viewer: Viewer, article_id: str
    ) -> Optional[HistoryArticle]:
        item = await self.get_article(viewer.organization_id, article_id)
        if item is None or not self.can_read(viewer, item):
            return None
        return item

    async def list_articles(
        self,
        viewer: Viewer,
        *,
        search: Optional[str] = None,
        member_id: Optional[str] = None,
        event_id: Optional[str] = None,
        apparatus_id: Optional[str] = None,
        document_id: Optional[str] = None,
        media_id: Optional[str] = None,
        level: Optional[PublicationLevel] = None,
        sort: str = "updated",
        limit: int = 60,
        offset: int = 0,
    ) -> tuple[list[HistoryArticle], int]:
        conditions = [HistoryArticle.organization_id == viewer.organization_id]
        if not viewer.can_view_archive:
            conditions.append(HistoryArticle.publication_level.in_(READABLE_BY_MEMBERS))
        elif level is not None:
            conditions.append(HistoryArticle.publication_level == level)
        if search and search.strip():
            pattern = like_pattern(search.strip())
            conditions.append(
                or_(
                    *(
                        column.ilike(pattern, escape=LIKE_ESCAPE_CHAR)
                        for column in _SEARCHED
                    )
                )
            )
        for link, column, value in (
            (HistoryArticleMember, HistoryArticleMember.member_id, member_id),
            (HistoryArticleEvent, HistoryArticleEvent.event_id, event_id),
            (
                HistoryArticleApparatus,
                HistoryArticleApparatus.apparatus_id,
                apparatus_id,
            ),
            (HistoryArticleDocument, HistoryArticleDocument.document_id, document_id),
        ):
            if value:
                conditions.append(
                    exists(
                        select(link.article_id).where(
                            link.article_id == HistoryArticle.id, column == str(value)
                        )
                    )
                )
        if media_id:
            # A photo is in an article as its cover or as a photo block.
            conditions.append(
                or_(
                    HistoryArticle.cover_media_id == str(media_id),
                    exists(
                        select(HistoryArticleBlock.id).where(
                            HistoryArticleBlock.article_id == HistoryArticle.id,
                            HistoryArticleBlock.media_id == str(media_id),
                        )
                    ),
                )
            )
        total = int(
            await self.db.scalar(
                select(func.count()).select_from(HistoryArticle).where(*conditions)
            )
            or 0
        )
        order = (
            (HistoryArticle.title, HistoryArticle.id)
            if sort == "title"
            else (HistoryArticle.updated_at.desc(), HistoryArticle.id)
        )
        result = await self.db.execute(
            select(HistoryArticle)
            .options(
                selectinload(HistoryArticle.cover_media).selectinload(
                    HistoryMedia.files
                )
            )
            .where(*conditions)
            .order_by(*order)
            .limit(limit)
            .offset(offset)
        )
        return list(result.scalars().unique().all()), total

    # ------------------------------------------------------------------
    # Views
    # ------------------------------------------------------------------

    def _readable_media(
        self, can_view_archive: bool, media: Optional[HistoryMedia]
    ) -> Optional[dict[str, Any]]:
        if media is None or not can_read_record(can_view_archive, media):
            return None
        return self.media.summary(media)

    def summary(self, viewer: Viewer, item: HistoryArticle) -> dict[str, Any]:
        return {
            "id": item.id,
            "title": item.title,
            "subtitle": item.subtitle,
            "byline": item.byline,
            "summary": item.summary,
            "cover": self._readable_media(viewer.can_view_archive, item.cover_media),
            "publication_level": item.publication_level,
            "updated_at": item.updated_at,
        }

    def _blocks(
        self, can_view_archive: bool, item: HistoryArticle, *, keep_hidden: bool
    ) -> list[dict[str, Any]]:
        """The body as the caller may read it. A photo block whose photo the
        caller may not see, or which was deleted from the archive, is left
        out, unless *keep_hidden* (the editor's view) keeps it with no photo
        so the Historian can see what is missing."""
        views: list[dict[str, Any]] = []
        for block in item.blocks:
            if block.kind == ArticleBlockKind.TEXT:
                views.append(
                    {
                        "id": block.id,
                        "kind": ArticleBlockKind.TEXT,
                        "html": sanitize_html(block.html),
                        "media": None,
                        "caption": None,
                        "size": ArticlePhotoSize.FULL,
                    }
                )
                continue
            media = self._readable_media(can_view_archive, block.media)
            if media is None and not keep_hidden:
                continue
            views.append(
                {
                    "id": block.id,
                    "kind": ArticleBlockKind.PHOTO,
                    "html": None,
                    "media": media,
                    "media_id": block.media_id,
                    "caption": block.caption,
                    "size": block.size,
                }
            )
        return views

    def _links(self, can_view_archive: bool, item: HistoryArticle) -> dict[str, Any]:
        return {
            "members": [
                {"member_id": link.member_id, "display_name": display_name(link.member)}
                for link in item.members
                if can_read_record(can_view_archive, link.member)
            ],
            "events": [
                self.events.summary(link.event)
                for link in item.event_links
                if can_read_record(can_view_archive, link.event)
            ],
            "apparatus": apparatus_tag_views(
                can_view_archive, (link.apparatus for link in item.apparatus_links)
            ),
            "documents": [
                self.documents.summary(link.history_document)
                for link in item.document_links
                if can_read_record(can_view_archive, link.history_document)
            ],
        }

    def archive_sources(self, view: dict[str, Any]) -> list[dict[str, Any]]:
        """The archive items an article draws on, for its Sources list: the
        documents and events it links to and the photos it shows, each once
        and only where the view already holds it (so only what the reader may
        see)."""
        sources: list[dict[str, Any]] = []
        seen: set[str] = set()
        photos = [view["cover"]] if view.get("cover") else []
        photos += [b["media"] for b in view["blocks"] if b.get("media")]
        for kind, entries in (
            ("document", view["documents"]),
            ("event", view["events"]),
            ("photo", photos),
        ):
            for entry in entries:
                key = f"{kind}:{entry['id']}"
                if key in seen:
                    continue
                seen.add(key)
                sources.append(
                    {"kind": kind, "id": entry["id"], "title": entry["title"]}
                )
        return sources

    def _catalogue(
        self, can_view_archive: bool, item: HistoryArticle, *, keep_hidden: bool
    ) -> dict[str, Any]:
        view: dict[str, Any] = {
            "id": item.id,
            "title": item.title,
            "subtitle": item.subtitle,
            "byline": item.byline,
            "summary": item.summary,
            "cover": self._readable_media(can_view_archive, item.cover_media),
            "citations": list(item.citations or []),
            "publication_level": item.publication_level,
            "updated_at": item.updated_at,
            "blocks": self._blocks(can_view_archive, item, keep_hidden=keep_hidden),
        }
        view.update(self._links(can_view_archive, item))
        view["sources"] = self.archive_sources(view)
        return view

    def member_view(self, viewer: Viewer, item: HistoryArticle) -> dict[str, Any]:
        view = self._catalogue(viewer.can_view_archive, item, keep_hidden=False)
        view["view"] = "member"
        return view

    def full_view(
        self,
        viewer: Viewer,
        item: HistoryArticle,
        clearance: Optional[dict[str, Any]],
        *,
        clearance_required: bool,
        cleared_for_public: bool,
    ) -> dict[str, Any]:
        view = self._catalogue(True, item, keep_hidden=True)
        view.update(
            {
                "view": "full",
                "cover_media_id": item.cover_media_id,
                "research_notes": item.research_notes,
                "published_at": item.published_at,
                "revision_number": item.revision_number,
                "public_revision_number": item.public_revision_number,
                "public_changes_pending": self.public_changes_pending(item),
                "photos_not_public": [p["title"] for p in self.photos_not_public(item)],
                "clearance": clearance,
                "clearance_required": clearance_required,
                "cleared_for_public": cleared_for_public,
                "can_edit": viewer.can_manage,
                "can_publish": viewer.can_publish,
                "created_at": item.created_at,
            }
        )
        return view

    def export_view(self, viewer: Viewer, item: HistoryArticle) -> dict[str, Any]:
        """What an export prints for this caller: the page they could read,
        never the research notes, and never a photo block they could not see
        (an editor's missing photos included)."""
        return self._catalogue(viewer.can_view_archive, item, keep_hidden=False)

    @staticmethod
    def photos_not_public(item: HistoryArticle) -> list[dict[str, str]]:
        """The photos an article shows (cover and blocks) that are not cleared
        for the public, each once. An article cannot go for public clearance
        while this is not empty."""
        found: dict[str, dict[str, str]] = {}
        shown = [item.cover_media] + [b.media for b in item.blocks]
        for media in shown:
            if media is not None and media.publication_level != PublicationLevel.PUBLIC:
                found.setdefault(media.id, {"id": media.id, "title": media.title})
        return list(found.values())

    # ------------------------------------------------------------------
    # Change history
    # ------------------------------------------------------------------

    def _snapshot(self, item: HistoryArticle) -> dict[str, Any]:
        data = {field: _enum_value(getattr(item, field)) for field in CATALOGUE_FIELDS}
        data["citations"] = list(item.citations or [])
        data["blocks"] = [
            {
                "kind": _enum_value(b.kind),
                "html": b.html,
                "media_id": b.media_id,
                "caption": b.caption,
                "size": _enum_value(b.size),
            }
            for b in item.blocks
        ]
        data["member_ids"] = [m.member_id for m in item.members]
        data["event_ids"] = [e.event_id for e in item.event_links]
        data["apparatus_ids"] = [a.apparatus_id for a in item.apparatus_links]
        data["document_ids"] = [d.document_id for d in item.document_links]
        return data

    def _public_snapshot(self, item: HistoryArticle) -> dict[str, Any]:
        """What the public may see: the article without its research notes,
        with only public photos, and a link only to a record that is itself
        public."""
        public = PublicationLevel.PUBLIC
        snapshot = copy.deepcopy(
            {
                key: value
                for key, value in self._snapshot(item).items()
                if key not in ("research_notes", "blocks", *LINK_KEYS)
            }
        )
        if item.cover_media is None or item.cover_media.publication_level != public:
            snapshot["cover_media_id"] = None
        snapshot["blocks"] = [
            {
                "kind": _enum_value(b.kind),
                "html": b.html,
                "media_id": b.media_id,
                "caption": b.caption,
                "size": _enum_value(b.size),
            }
            for b in item.blocks
            if b.kind == ArticleBlockKind.TEXT
            or (b.media is not None and b.media.publication_level == public)
        ]
        snapshot["members"] = [
            display_name(m.member)
            for m in item.members
            if m.member.publication_level == public
        ]
        snapshot["event_ids"] = [
            e.event_id for e in item.event_links if e.event.publication_level == public
        ]
        snapshot["apparatus"] = [
            a.apparatus.name
            for a in item.apparatus_links
            if a.apparatus.publication_level == public
        ]
        snapshot["document_ids"] = [
            d.document_id
            for d in item.document_links
            if d.history_document.publication_level == public
        ]
        return snapshot

    # ------------------------------------------------------------------
    # Validation
    # ------------------------------------------------------------------

    async def _validated_ids(
        self,
        model: Any,
        column: Any,
        organization_id: str,
        ids: Iterable[str],
        what: str,
    ) -> list[str]:
        wanted = list(dict.fromkeys(str(i) for i in ids))
        if not wanted:
            return []
        found = set(
            (
                await self.db.execute(
                    select(column).where(
                        model.organization_id == str(organization_id),
                        column.in_(wanted),
                    )
                )
            ).scalars()
        )
        if len(found) != len(wanted):
            raise ValueError(f"A linked {what} is not in this department's archive")
        return wanted

    async def _validated_photo_ids(
        self, organization_id: str, ids: Iterable[Optional[str]]
    ) -> None:
        """Every photo an article shows is a photo (not a recording) in the
        department's archive."""
        wanted = {str(i) for i in ids if i}
        if not wanted:
            return
        found = set(
            (
                await self.db.execute(
                    select(HistoryMedia.id).where(
                        HistoryMedia.organization_id == str(organization_id),
                        HistoryMedia.kind == MediaKind.PHOTO,
                        HistoryMedia.id.in_(wanted),
                    )
                )
            ).scalars()
        )
        if found != wanted:
            raise ValueError(
                "A photo in this article is not a photo in this department's archive"
            )

    @staticmethod
    def _clean_blocks(blocks: Iterable[dict[str, Any]]) -> list[dict[str, Any]]:
        cleaned: list[dict[str, Any]] = []
        for block in blocks:
            try:
                kind = ArticleBlockKind(_enum_value(block.get("kind")))
            except ValueError:
                raise ValueError("Each block is either text or a photo") from None
            if kind == ArticleBlockKind.TEXT:
                raw = block.get("html") or ""
                if len(raw) > MAX_HTML_LENGTH:
                    raise ValueError("A text block is too long; split it in two")
                html = sanitize_html(raw)
                # An empty paragraph left by the editor is not a block.
                if not html_to_text(html):
                    continue
                cleaned.append({"kind": kind, "html": html})
                continue
            media_id = block.get("media_id")
            if not media_id:
                raise ValueError("Choose a photo for each photo block")
            caption = (block.get("caption") or "").strip() or None
            if caption is not None and len(caption) > CAPTION_MAX:
                raise ValueError(f"A caption can be at most {CAPTION_MAX} characters")
            cleaned.append(
                {
                    "kind": kind,
                    "media_id": str(media_id),
                    "caption": caption,
                    "size": ArticlePhotoSize(
                        _enum_value(block.get("size")) or ArticlePhotoSize.FULL
                    ),
                }
            )
        if len(cleaned) > MAX_BLOCKS:
            raise ValueError(f"An article can have at most {MAX_BLOCKS} blocks")
        return cleaned

    # ------------------------------------------------------------------
    # Body and links
    # ------------------------------------------------------------------

    async def _write_blocks(
        self, item: HistoryArticle, blocks: Optional[list[dict[str, Any]]]
    ) -> None:
        """Replace the body when *blocks* is sent; leave it alone when not."""
        if blocks is None:
            return
        cleaned = self._clean_blocks(blocks)
        await self._validated_photo_ids(
            item.organization_id, (b.get("media_id") for b in cleaned)
        )
        await self.db.execute(
            delete(HistoryArticleBlock).where(HistoryArticleBlock.article_id == item.id)
        )
        # The old rows are gone from the database; drop them from the session
        # too, so the unique (article, position) key is never met twice.
        await self.db.flush()
        for position, block in enumerate(cleaned):
            self.db.add(
                HistoryArticleBlock(article_id=item.id, position=position, **block)
            )
        await self.db.flush()

    async def _write_links(self, item: HistoryArticle, links: dict[str, Any]) -> None:
        """Replace each link set *links* names; a set it does not name is
        left alone."""
        org = item.organization_id
        plans: list[tuple[Any, str, list[str]]] = []
        if "member_ids" in links:
            plans.append(
                (
                    HistoryArticleMember,
                    "member_id",
                    await self._validated_ids(
                        HistoricalMember,
                        HistoricalMember.id,
                        org,
                        links["member_ids"] or [],
                        "person",
                    ),
                )
            )
        if "event_ids" in links:
            plans.append(
                (
                    HistoryArticleEvent,
                    "event_id",
                    await self._validated_ids(
                        HistoryEvent,
                        HistoryEvent.id,
                        org,
                        links["event_ids"] or [],
                        "event",
                    ),
                )
            )
        if "apparatus_ids" in links:
            plans.append(
                (
                    HistoryArticleApparatus,
                    "apparatus_id",
                    await validated_apparatus_ids(
                        self.db, org, links["apparatus_ids"] or []
                    ),
                )
            )
        if "document_ids" in links:
            plans.append(
                (
                    HistoryArticleDocument,
                    "document_id",
                    await self._validated_ids(
                        HistoryDocument,
                        HistoryDocument.document_id,
                        org,
                        links["document_ids"] or [],
                        "document",
                    ),
                )
            )
        for model, key, wanted in plans:
            await self.db.execute(delete(model).where(model.article_id == item.id))
            for position, value in enumerate(wanted):
                self.db.add(
                    model(article_id=item.id, position=position, **{key: value})
                )
        await self.db.flush()

    async def _settle_search_text(self, item: HistoryArticle) -> HistoryArticle:
        reloaded = await self._reload(item)
        reloaded.search_text = search_text_of(reloaded) or None
        await self.db.flush()
        return reloaded

    # ------------------------------------------------------------------
    # Writes
    # ------------------------------------------------------------------

    async def create(
        self,
        organization_id: str,
        values: dict[str, Any],
        blocks: Optional[list[dict[str, Any]]],
        links: dict[str, Any],
        actor_id: str,
        actor_name: Optional[str],
    ) -> HistoryArticle:
        values = _clean(values)
        if not values.get("title"):
            raise ValueError("Enter a title")
        await self._validated_photo_ids(organization_id, [values.get("cover_media_id")])
        item = HistoryArticle(
            organization_id=str(organization_id),
            created_by=actor_id,
            updated_by=actor_id,
            revision_number=1,
            substantial_revision_number=1,
        )
        for field in CATALOGUE_FIELDS:
            if values.get(field) is not None:
                setattr(item, field, values[field])
        if "byline" not in values:
            # A byline left out entirely defaults to whoever wrote it; one
            # sent empty means "no byline".
            item.byline = (actor_name or "").strip()[:200] or None
        self.db.add(item)
        await self.db.flush()
        await self._write_blocks(item, blocks or [])
        await self._write_links(item, links)
        created = await self._settle_search_text(item)
        await self._log(created, RevisionKind.CREATED, actor_id, with_snapshot=True)
        return created

    async def update(
        self,
        item: HistoryArticle,
        values: dict[str, Any],
        blocks: Optional[list[dict[str, Any]]],
        links: dict[str, Any],
        *,
        edit_kind: str,
        edit_note: Optional[str],
        actor_id: str,
    ) -> HistoryArticle:
        values = _clean(values)
        if "title" in values and not values["title"]:
            raise ValueError("Enter a title")
        if "cover_media_id" in values:
            await self._validated_photo_ids(
                item.organization_id, [values["cover_media_id"]]
            )
        before = self._snapshot(item)
        apply_updates(
            item,
            {k: v for k, v in values.items() if k in CATALOGUE_FIELDS},
            skip=set(),
        )
        item.updated_by = actor_id
        await self.db.flush()
        await self._write_blocks(item, blocks)
        await self._write_links(item, links)
        reloaded = await self._settle_search_text(item)
        after = self._snapshot(reloaded)
        # A change to the body or to what the article links to is
        # substantial: it changes what the article shows.
        changed = any(
            before[key] != after[key]
            for key in (*SUBSTANTIAL_FIELDS, "blocks", *LINK_KEYS)
        )
        return await self._after_edit(
            reloaded, edit_kind == "substantial" or changed, edit_note, actor_id
        )

    # ------------------------------------------------------------------
    # Person merge
    # ------------------------------------------------------------------

    async def move_members(self, from_member_id: str, to_member_id: str) -> None:
        """A person merge's part: the removed person's article links move to
        the kept person. Where both were linked to one article, the kept
        person's link stays."""
        both = set(
            (
                await self.db.execute(
                    select(HistoryArticleMember.article_id).where(
                        HistoryArticleMember.member_id == to_member_id
                    )
                )
            ).scalars()
        )
        result = await self.db.execute(
            select(HistoryArticleMember).where(
                HistoryArticleMember.member_id == from_member_id
            )
        )
        for link in result.scalars().all():
            if link.article_id not in both:
                self.db.add(
                    HistoryArticleMember(
                        article_id=link.article_id,
                        member_id=to_member_id,
                        position=link.position,
                    )
                )
            await self.db.delete(link)
        await self.db.flush()
