"""
The department's History, as its website may show it (phase 7).

Everything here is built from each record's **cleared public copy**
(``public_snapshot``), never from the live record: a draft edit waiting for
the clearance list, a member-only field, research notes or a tag on someone
who is not public cannot reach the website, because none of them is in that
copy. A record is served only while it is published to the public and its
kind is switched on in :class:`HistoryPublicSettings`.

Each view names its fields one by one rather than passing the copy through,
so a field added to a record's copy later is not published by accident.

A link to another record (an event's photos, an article's documents) is given
only when that record is itself public **and** its kind is switched on. Names
the copy holds as text (the people on an event, the apparatus on a photo) were
cleared with the record and are given as text.

Files are named by signed links (``history_public_links``); the endpoint that
serves one re-checks the record with :meth:`HistoryPublicService.file_allowed`.
"""

import calendar
import hashlib
import secrets
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from typing import Any, Iterable, Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.history import (
    ApparatusDisposition,
    HistoricalMember,
    HistoryApparatus,
    HistoryArticle,
    HistoryDocument,
    HistoryEvent,
    HistoryMedia,
    HistoryPublicSettings,
    HistoryTitle,
    MediaFileRole,
    MediaKind,
    PublicationLevel,
    PublicWidgetTheme,
)
from app.services import history_public_links as links
from app.services.history_timeline_service import today_days
from app.utils.markdown_render import render_markdown
from app.utils.rich_text import sanitize_html

PUBLIC = PublicationLevel.PUBLIC

TYPE_PEOPLE = "people"
TYPE_HONOR_ROLL = "honor_roll"
TYPE_PHOTOS = "photos"
TYPE_DOCUMENTS = "documents"
TYPE_EVENTS = "events"
TYPE_APPARATUS = "apparatus"
TYPE_ARTICLES = "articles"
TYPE_TIMELINE = "timeline"
TYPE_TODAY = "today"

#: Each part of the public History API and the switch that opens it.
SWITCHES = {
    TYPE_PEOPLE: "show_people",
    TYPE_HONOR_ROLL: "show_honor_roll",
    TYPE_PHOTOS: "show_photos",
    TYPE_DOCUMENTS: "show_documents",
    TYPE_EVENTS: "show_events",
    TYPE_APPARATUS: "show_apparatus",
    TYPE_ARTICLES: "show_articles",
    TYPE_TIMELINE: "show_timeline",
    TYPE_TODAY: "show_today",
}

#: "This week in history" looks this many days ahead when today has nothing.
WEEK_AHEAD_DAYS = 7

_DISPOSITION_TEXT = {
    ApparatusDisposition.SOLD.value: "sold",
    ApparatusDisposition.TRADED.value: "traded",
    ApparatusDisposition.SCRAPPED.value: "scrapped",
    ApparatusDisposition.PRESERVED.value: "preserved",
    ApparatusDisposition.MUSEUM.value: "went to a museum",
}


def hash_widget_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _iso_date(value: Any) -> Optional[date]:
    if isinstance(value, date):
        return value
    if isinstance(value, str) and value:
        try:
            return date.fromisoformat(value[:10])
        except ValueError:
            return None
    return None


def _year_span(start: Any, end: Any) -> Optional[tuple[int, int]]:
    """The years a record covers; one end stands for both when the other is
    missing."""
    first, last = _iso_date(start), _iso_date(end)
    if first is None and last is None:
        return None
    if first is None:
        first = last
    if last is None:
        last = first
    if first is None or last is None:
        return None
    return first.year, last.year


def _in_decade(span: Optional[tuple[int, int]], decade: Optional[int]) -> bool:
    if decade is None:
        return True
    if span is None:
        return False
    return span[0] <= decade + 9 and span[1] >= decade


def _pick(snapshot: dict[str, Any], fields: Iterable[str]) -> dict[str, Any]:
    return {field: snapshot.get(field) for field in fields}


_PERSON_FIELDS = (
    "display_name",
    "first_name",
    "middle_name",
    "last_name",
    "suffix",
    "nickname",
    "badge_number",
    "service_years",
    "titles",
    "is_memorial",
    "is_line_of_duty_death",
    # Present in the copy only when each was set to public itself.
    "death_date",
    "death_date_precision",
    "death_date_circa",
    "death_circumstances",
    "burial_location",
)
_PERIOD_FIELDS = (
    "start_date",
    "start_precision",
    "start_circa",
    "end_date",
    "end_precision",
    "end_circa",
    "is_ongoing",
)
_MEDIA_FIELDS = (
    "title",
    "description",
    "taken_date",
    "taken_date_precision",
    "taken_date_circa",
    "place",
    "creator",
    "source_name",
    "rights_note",
    "tags",
    "apparatus",
)
_DOCUMENT_FIELDS = (
    *_MEDIA_FIELDS[:-2],
    "document_type_name",
    "author",
    "recipient",
    "transcription",
    "tags",
    "apparatus",
)
_EVENT_FIELDS = (
    "title",
    "description",
    "start_date",
    "start_precision",
    "start_circa",
    "end_date",
    "end_precision",
    "end_circa",
    "place",
    "station_name",
    "event_type_name",
    "source_name",
)
_APPARATUS_FIELDS = (
    "name",
    "apparatus_type_name",
    "year",
    "make",
    "model",
    "body_builder",
    "pump_gpm",
    "tank_gallons",
    "ladder_feet",
    "in_service_date",
    "in_service_precision",
    "in_service_circa",
    "out_of_service_date",
    "out_of_service_precision",
    "out_of_service_circa",
    "disposition",
    "current_location",
    "description",
    "source_name",
)
_DESIGNATION_FIELDS = (
    "designation",
    "station_name",
    "start_date",
    "start_precision",
    "start_circa",
    "end_date",
    "end_precision",
    "end_circa",
)
_ARTICLE_FIELDS = ("title", "subtitle", "byline", "summary")


@dataclass
class PublicRecords:
    """Every record of the department the website may show right now, by
    kind, each with its cleared copy. Loaded once per request."""

    settings: HistoryPublicSettings
    people: dict[str, HistoricalMember]
    media: dict[str, HistoryMedia]
    documents: dict[str, HistoryDocument]
    events: dict[str, HistoryEvent]
    apparatus: dict[str, HistoryApparatus]
    articles: dict[str, HistoryArticle]


class HistoryPublicService:
    def __init__(self, db: AsyncSession):
        self.db = db

    # ------------------------------------------------------------------
    # Settings
    # ------------------------------------------------------------------

    async def settings(self, organization_id: str) -> HistoryPublicSettings:
        """The department's row, or an unsaved one with every switch off."""
        row = await self.db.scalar(
            select(HistoryPublicSettings).where(
                HistoryPublicSettings.organization_id == str(organization_id)
            )
        )
        if row is not None:
            return row
        return HistoryPublicSettings(
            organization_id=str(organization_id),
            **{field: False for field in SWITCHES.values()},
            widget_theme=PublicWidgetTheme.AUTO,
            widget_show_branding=True,
        )

    async def _saved_settings(self, organization_id: str) -> HistoryPublicSettings:
        row = await self.settings(organization_id)
        if row.id is None:
            self.db.add(row)
            await self.db.flush()
        return row

    async def update_settings(
        self, organization_id: str, values: dict[str, Any], actor_id: str
    ) -> HistoryPublicSettings:
        row = await self._saved_settings(organization_id)
        for name, field in SWITCHES.items():
            if name in values and values[name] is not None:
                setattr(row, field, bool(values[name]))
        if values.get("widget_theme") is not None:
            row.widget_theme = PublicWidgetTheme(values["widget_theme"])
        if values.get("widget_show_branding") is not None:
            row.widget_show_branding = bool(values["widget_show_branding"])
        row.updated_by = actor_id
        await self.db.flush()
        return row

    async def make_widget_token(self, organization_id: str, actor_id: str) -> str:
        """A new secret for the widget's link, replacing any before it. Only
        its hash is kept; the caller shows the secret once."""
        row = await self._saved_settings(organization_id)
        token = secrets.token_urlsafe(32)
        row.widget_token_hash = hash_widget_token(token)
        row.widget_token_created_at = datetime.now(timezone.utc)
        row.updated_by = actor_id
        await self.db.flush()
        return token

    async def remove_widget_token(self, organization_id: str, actor_id: str) -> None:
        row = await self._saved_settings(organization_id)
        row.widget_token_hash = None
        row.widget_token_created_at = None
        row.updated_by = actor_id
        await self.db.flush()

    async def settings_for_widget(self, token: str) -> Optional[HistoryPublicSettings]:
        """The settings whose widget link this is. Looked up by the token's
        hash, which is unique, so the secret itself is never compared."""
        if not token or not 32 <= len(token) <= 64:
            return None
        return await self.db.scalar(
            select(HistoryPublicSettings).where(
                HistoryPublicSettings.widget_token_hash == hash_widget_token(token)
            )
        )

    @staticmethod
    def is_on(settings: HistoryPublicSettings, kind: str) -> bool:
        return bool(getattr(settings, SWITCHES[kind]))

    # ------------------------------------------------------------------
    # Loading what is public
    # ------------------------------------------------------------------

    async def _public(self, model: Any, organization_id: str, *options: Any) -> Any:
        result = await self.db.execute(
            select(model)
            .options(*options)
            .where(
                model.organization_id == str(organization_id),
                model.publication_level == PUBLIC,
                model.public_snapshot.is_not(None),
            )
        )
        return result.scalars().all()

    async def records(self, organization_id: str) -> PublicRecords:
        """Each switched-on kind's public records; a kind switched off loads
        as empty, so nothing below can link to it."""
        settings = await self.settings(organization_id)
        org = str(organization_id)

        async def load(kind: str, model: Any, key: str, *options: Any) -> dict:
            if not self.is_on(settings, kind):
                return {}
            rows = await self._public(model, org, *options)
            return {str(getattr(row, key)): row for row in rows}

        people_on = self.is_on(settings, TYPE_PEOPLE) or self.is_on(
            settings, TYPE_HONOR_ROLL
        )
        people = (
            {str(p.id): p for p in await self._public(HistoricalMember, org)}
            if people_on
            else {}
        )
        return PublicRecords(
            settings=settings,
            people=people,
            media=await load(
                TYPE_PHOTOS, HistoryMedia, "id", selectinload(HistoryMedia.files)
            ),
            documents=await load(
                TYPE_DOCUMENTS,
                HistoryDocument,
                "document_id",
                selectinload(HistoryDocument.files),
            ),
            events=await load(TYPE_EVENTS, HistoryEvent, "id"),
            apparatus=await load(TYPE_APPARATUS, HistoryApparatus, "id"),
            articles=await load(TYPE_ARTICLES, HistoryArticle, "id"),
        )

    # ------------------------------------------------------------------
    # Views, one per kind
    # ------------------------------------------------------------------

    @staticmethod
    def _has_file(item: Any, role: MediaFileRole) -> bool:
        return any(f.role == role for f in item.files)

    def media_summary(
        self, item: HistoryMedia, *, context: Optional[str] = None
    ) -> dict[str, Any]:
        snap = item.public_snapshot or {}
        org = item.organization_id
        is_photo = item.kind == MediaKind.PHOTO
        return {
            "id": item.id,
            "kind": item.kind.value,
            "title": snap.get("title"),
            "taken_date": snap.get("taken_date"),
            "taken_date_precision": snap.get("taken_date_precision"),
            "taken_date_circa": snap.get("taken_date_circa"),
            "thumbnail_url": (
                links.link(org, links.KIND_PHOTO, item.id, "thumbnail", context=context)
                if self._has_file(item, MediaFileRole.THUMBNAIL)
                else None
            ),
            # Recordings and films are listed but not streamed (owner
            # decision, 2026-11-24): a photo alone has a viewing link.
            "image_url": (
                links.link(org, links.KIND_PHOTO, item.id, "display", context=context)
                if is_photo and self._has_file(item, MediaFileRole.DISPLAY)
                else None
            ),
        }

    def media_view(self, item: HistoryMedia) -> dict[str, Any]:
        view = self.media_summary(item)
        view.update(_pick(item.public_snapshot or {}, _MEDIA_FIELDS))
        return view

    def document_summary(self, item: HistoryDocument) -> dict[str, Any]:
        snap = item.public_snapshot or {}
        org = item.organization_id
        return {
            "id": item.document_id,
            "kind": item.kind.value,
            "title": snap.get("title"),
            "document_type_name": snap.get("document_type_name"),
            "taken_date": snap.get("taken_date"),
            "taken_date_precision": snap.get("taken_date_precision"),
            "taken_date_circa": snap.get("taken_date_circa"),
            "thumbnail_url": (
                links.link(org, links.KIND_DOCUMENT, item.document_id, "thumbnail")
                if self._has_file(item, MediaFileRole.THUMBNAIL)
                else None
            ),
            "file_url": (
                links.link(org, links.KIND_DOCUMENT, item.document_id, "file")
                if self._has_file(item, MediaFileRole.DISPLAY)
                else None
            ),
        }

    def document_view(self, item: HistoryDocument) -> dict[str, Any]:
        view = self.document_summary(item)
        view.update(_pick(item.public_snapshot or {}, _DOCUMENT_FIELDS))
        return view

    @staticmethod
    def person_summary(person: HistoricalMember) -> dict[str, Any]:
        snap = person.public_snapshot or {}
        return {
            "id": person.id,
            "display_name": snap.get("display_name"),
            "service_years": snap.get("service_years"),
            "titles": list(snap.get("titles") or []),
            "is_line_of_duty_death": bool(snap.get("is_line_of_duty_death")),
        }

    def person_view(self, person: HistoricalMember) -> dict[str, Any]:
        snap = person.public_snapshot or {}
        view = {"id": person.id, **_pick(snap, _PERSON_FIELDS)}
        view["titles"] = list(snap.get("titles") or [])
        view["biography_html"] = render_markdown(snap.get("biography")) or None
        view["service_periods"] = [
            _pick(period, _PERIOD_FIELDS)
            for period in snap.get("service_periods") or []
            if isinstance(period, dict)
        ]
        return view

    @staticmethod
    def event_summary(item: HistoryEvent) -> dict[str, Any]:
        snap = item.public_snapshot or {}
        return {
            "id": item.id,
            **_pick(
                snap,
                (
                    "title",
                    "start_date",
                    "start_precision",
                    "start_circa",
                    "end_date",
                    "end_precision",
                    "end_circa",
                    "place",
                    "event_type_name",
                ),
            ),
        }

    def event_view(self, item: HistoryEvent, records: PublicRecords) -> dict[str, Any]:
        snap = item.public_snapshot or {}
        view = {"id": item.id, **_pick(snap, _EVENT_FIELDS)}
        view["people"] = [
            {"display_name": m.get("display_name"), "role": m.get("role")}
            for m in snap.get("members") or []
            if isinstance(m, dict)
        ]
        view["apparatus"] = list(snap.get("apparatus") or [])
        view["photos"] = [
            self.media_summary(records.media[media_id])
            for media_id in snap.get("media_ids") or []
            if media_id in records.media
        ]
        view["documents"] = [
            self.document_summary(records.documents[document_id])
            for document_id in snap.get("document_ids") or []
            if document_id in records.documents
        ]
        return view

    @staticmethod
    def apparatus_summary(item: HistoryApparatus) -> dict[str, Any]:
        snap = item.public_snapshot or {}
        designations = [
            d for d in snap.get("designations") or [] if isinstance(d, dict)
        ]
        return {
            "id": item.id,
            **_pick(
                snap,
                (
                    "name",
                    "apparatus_type_name",
                    "year",
                    "in_service_date",
                    "in_service_precision",
                    "out_of_service_date",
                    "out_of_service_precision",
                ),
            ),
            "designations": [d.get("designation") for d in designations],
        }

    @staticmethod
    def apparatus_view(item: HistoryApparatus) -> dict[str, Any]:
        snap = item.public_snapshot or {}
        view = {"id": item.id, **_pick(snap, _APPARATUS_FIELDS)}
        view["designations"] = [
            _pick(d, _DESIGNATION_FIELDS)
            for d in snap.get("designations") or []
            if isinstance(d, dict)
        ]
        return view

    def _article_photo(
        self, article: HistoryArticle, media_id: Optional[str], extra: Any
    ) -> Optional[dict[str, Any]]:
        """A photo shown in an article, linked through the article. It need
        not be listed in the photo section, but it must still be public."""
        if not media_id:
            return None
        item = extra.get(media_id)
        if item is None:
            return None
        return self.media_summary(item, context=article.id)

    async def _article_media(self, article: HistoryArticle) -> dict[str, HistoryMedia]:
        """The public photos an article shows, whether or not the photo
        section is switched on: they are part of the article."""
        snap = article.public_snapshot or {}
        wanted = {
            b.get("media_id")
            for b in snap.get("blocks") or []
            if isinstance(b, dict) and b.get("media_id")
        }
        if snap.get("cover_media_id"):
            wanted.add(snap["cover_media_id"])
        if not wanted:
            return {}
        result = await self.db.execute(
            select(HistoryMedia)
            .options(selectinload(HistoryMedia.files))
            .where(
                HistoryMedia.organization_id == article.organization_id,
                HistoryMedia.id.in_([str(w) for w in wanted]),
                HistoryMedia.publication_level == PUBLIC,
                HistoryMedia.public_snapshot.is_not(None),
                HistoryMedia.kind == MediaKind.PHOTO,
            )
        )
        return {item.id: item for item in result.scalars().all()}

    async def article_summary(self, article: HistoryArticle) -> dict[str, Any]:
        snap = article.public_snapshot or {}
        media = await self._article_media(article)
        return {
            "id": article.id,
            **_pick(snap, _ARTICLE_FIELDS),
            "published_at": article.published_at,
            "cover": self._article_photo(article, snap.get("cover_media_id"), media),
        }

    async def article_view(
        self, article: HistoryArticle, records: PublicRecords
    ) -> dict[str, Any]:
        snap = article.public_snapshot or {}
        media = await self._article_media(article)
        blocks: list[dict[str, Any]] = []
        for block in snap.get("blocks") or []:
            if not isinstance(block, dict):
                continue
            if block.get("kind") == "text":
                blocks.append(
                    {"kind": "text", "html": sanitize_html(block.get("html"))}
                )
                continue
            photo = self._article_photo(article, block.get("media_id"), media)
            # A photo withdrawn from the public since the article was cleared
            # is left out rather than shown as a broken image.
            if photo is not None:
                blocks.append(
                    {
                        "kind": "photo",
                        "photo": photo,
                        "caption": block.get("caption"),
                        "size": block.get("size") or "full",
                    }
                )
        return {
            "id": article.id,
            **_pick(snap, _ARTICLE_FIELDS),
            "published_at": article.published_at,
            "cover": self._article_photo(article, snap.get("cover_media_id"), media),
            "blocks": blocks,
            "people": list(snap.get("members") or []),
            "apparatus": list(snap.get("apparatus") or []),
            "events": [
                self.event_summary(records.events[event_id])
                for event_id in snap.get("event_ids") or []
                if event_id in records.events
            ],
            "documents": [
                self.document_summary(records.documents[document_id])
                for document_id in snap.get("document_ids") or []
                if document_id in records.documents
            ],
            "citations": list(snap.get("citations") or []),
            "pdf_url": links.link(
                article.organization_id, links.KIND_ARTICLE, article.id, "pdf"
            ),
        }

    # ------------------------------------------------------------------
    # Lists
    # ------------------------------------------------------------------

    @staticmethod
    def _page(items: list[Any], limit: int, offset: int) -> dict[str, Any]:
        return {"items": items[offset : offset + limit], "total": len(items)}

    async def list_people(
        self, records: PublicRecords, decade: Optional[int], limit: int, offset: int
    ) -> dict[str, Any]:
        def span(person: HistoricalMember) -> Optional[tuple[int, int]]:
            periods = (person.public_snapshot or {}).get("service_periods") or []
            years = [
                y
                for p in periods
                if isinstance(p, dict)
                for y in (_year_span(p.get("start_date"), p.get("end_date")) or ())
            ]
            return (min(years), max(years)) if years else None

        people = sorted(
            (p for p in records.people.values() if _in_decade(span(p), decade)),
            key=lambda p: (
                str((p.public_snapshot or {}).get("last_name") or "").casefold(),
                str((p.public_snapshot or {}).get("first_name") or "").casefold(),
                p.id,
            ),
        )
        return self._page([self.person_summary(p) for p in people], limit, offset)

    async def honor_roll(self, records: PublicRecords) -> list[dict[str, Any]]:
        fallen = [
            p
            for p in records.people.values()
            if (p.public_snapshot or {}).get("is_line_of_duty_death")
        ]
        fallen.sort(
            key=lambda p: (
                _iso_date((p.public_snapshot or {}).get("death_date")) or date.max,
                str((p.public_snapshot or {}).get("last_name") or "").casefold(),
            )
        )
        return [
            {
                **self.person_summary(p),
                **_pick(
                    p.public_snapshot or {},
                    (
                        "death_date",
                        "death_date_precision",
                        "death_date_circa",
                        "death_circumstances",
                    ),
                ),
            }
            for p in fallen
        ]

    @staticmethod
    def _dated_title(snap: dict[str, Any]) -> tuple[date, str]:
        return (
            _iso_date(snap.get("taken_date")) or date.max,
            str(snap.get("title") or "").casefold(),
        )

    async def list_media(
        self, records: PublicRecords, decade: Optional[int], limit: int, offset: int
    ) -> dict[str, Any]:
        items = sorted(
            (
                m
                for m in records.media.values()
                if _in_decade(
                    _year_span((m.public_snapshot or {}).get("taken_date"), None),
                    decade,
                )
            ),
            key=lambda m: (*self._dated_title(m.public_snapshot or {}), m.id),
        )
        return self._page([self.media_summary(m) for m in items], limit, offset)

    async def list_documents(
        self, records: PublicRecords, decade: Optional[int], limit: int, offset: int
    ) -> dict[str, Any]:
        items = sorted(
            (
                d
                for d in records.documents.values()
                if _in_decade(
                    _year_span((d.public_snapshot or {}).get("taken_date"), None),
                    decade,
                )
            ),
            key=lambda d: (*self._dated_title(d.public_snapshot or {}), d.document_id),
        )
        return self._page([self.document_summary(d) for d in items], limit, offset)

    async def list_events(
        self, records: PublicRecords, decade: Optional[int], limit: int, offset: int
    ) -> dict[str, Any]:
        def span(item: HistoryEvent) -> Optional[tuple[int, int]]:
            snap = item.public_snapshot or {}
            return _year_span(snap.get("start_date"), snap.get("end_date"))

        items = sorted(
            (e for e in records.events.values() if _in_decade(span(e), decade)),
            key=lambda e: (
                _iso_date((e.public_snapshot or {}).get("start_date")) or date.max,
                str((e.public_snapshot or {}).get("title") or "").casefold(),
                e.id,
            ),
        )
        return self._page([self.event_summary(e) for e in items], limit, offset)

    async def list_apparatus(
        self, records: PublicRecords, decade: Optional[int], limit: int, offset: int
    ) -> dict[str, Any]:
        def span(item: HistoryApparatus) -> Optional[tuple[int, int]]:
            snap = item.public_snapshot or {}
            return _year_span(
                snap.get("in_service_date"), snap.get("out_of_service_date")
            )

        items = sorted(
            (a for a in records.apparatus.values() if _in_decade(span(a), decade)),
            key=lambda a: (
                _iso_date((a.public_snapshot or {}).get("in_service_date")) or date.max,
                str((a.public_snapshot or {}).get("name") or "").casefold(),
                a.id,
            ),
        )
        return self._page([self.apparatus_summary(a) for a in items], limit, offset)

    async def list_articles(
        self, records: PublicRecords, limit: int, offset: int
    ) -> dict[str, Any]:
        epoch = datetime.min.replace(tzinfo=timezone.utc)
        items = sorted(
            records.articles.values(),
            key=lambda a: (a.published_at or epoch, a.id),
            reverse=True,
        )
        page = items[offset : offset + limit]
        return {
            "items": [await self.article_summary(a) for a in page],
            "total": len(items),
        }

    # ------------------------------------------------------------------
    # What's new
    # ------------------------------------------------------------------

    async def feed(
        self, records: PublicRecords, before: Optional[datetime], limit: int
    ) -> list[dict[str, Any]]:
        """What was most recently published to the public, across every
        switched-on kind, newest first."""
        entries: list[tuple[datetime, dict[str, Any]]] = []

        def add(record: Any, kind: str, title: Any, extra: dict[str, Any]) -> None:
            when = record.published_at
            if when is None:
                return
            if when.tzinfo is None:
                when = when.replace(tzinfo=timezone.utc)
            if before is not None and when >= before:
                return
            entries.append(
                (
                    when,
                    {
                        "type": kind,
                        "id": extra.pop("id"),
                        "title": title,
                        "published_at": when,
                        **extra,
                    },
                )
            )

        if self.is_on(records.settings, TYPE_PEOPLE):
            for person in records.people.values():
                summary = self.person_summary(person)
                add(person, "person", summary.pop("display_name"), summary)
        for item in records.media.values():
            summary = self.media_summary(item)
            add(item, "photo", summary.pop("title"), summary)
        for paper in records.documents.values():
            summary = self.document_summary(paper)
            add(paper, "document", summary.pop("title"), summary)
        for event in records.events.values():
            summary = self.event_summary(event)
            add(event, "event", summary.pop("title"), summary)
        for truck in records.apparatus.values():
            summary = self.apparatus_summary(truck)
            add(truck, "apparatus", summary.pop("name"), summary)
        for article in records.articles.values():
            summary = await self.article_summary(article)
            add(article, "article", summary.pop("title"), summary)
        entries.sort(key=lambda pair: (pair[0], pair[1]["id"]), reverse=True)
        return [entry for _, entry in entries[:limit]]

    # ------------------------------------------------------------------
    # The timeline and "Today in history"
    # ------------------------------------------------------------------

    async def _title_names(self, organization_id: str) -> dict[str, str]:
        """Titles switched onto the timeline, by id."""
        result = await self.db.execute(
            select(HistoryTitle.id, HistoryTitle.name).where(
                HistoryTitle.organization_id == str(organization_id),
                HistoryTitle.show_on_timeline.is_(True),
            )
        )
        return {str(i): str(n) for i, n in result.all()}

    async def timeline_entries(self, records: PublicRecords) -> list[dict[str, Any]]:
        """Every dated entry the website may show, oldest first: events,
        apparatus entering and leaving service, line-of-duty deaths and the
        titles switched onto the timeline, each read from its cleared copy."""
        entries: list[dict[str, Any]] = []

        def entry(
            kind: str,
            record_type: Optional[str],
            record_id: str,
            when: Any,
            precision: Any,
            circa: Any,
            label: str,
            *,
            key_suffix: str = "",
            detail: Optional[str] = None,
            end: tuple[Any, Any, Any] = (None, None, False),
            event_type_name: Optional[str] = None,
        ) -> None:
            day = _iso_date(when)
            if day is None:
                return
            end_day = _iso_date(end[0])
            entries.append(
                {
                    "key": f"{kind}:{record_id}{key_suffix}",
                    "kind": kind,
                    "date": day,
                    "precision": precision or "year",
                    "circa": bool(circa),
                    "end_date": end_day,
                    "end_precision": (end[1] or "year") if end_day else None,
                    "end_circa": bool(end[2]) if end_day else False,
                    "label": label,
                    "detail": detail,
                    "record_type": record_type,
                    "record_id": record_id if record_type else None,
                    "event_type_name": event_type_name,
                }
            )

        for event in records.events.values():
            snap = event.public_snapshot or {}
            entry(
                "event",
                "event",
                event.id,
                snap.get("start_date"),
                snap.get("start_precision"),
                snap.get("start_circa"),
                str(snap.get("title") or ""),
                detail=snap.get("place"),
                end=(
                    snap.get("end_date"),
                    snap.get("end_precision"),
                    snap.get("end_circa"),
                ),
                event_type_name=snap.get("event_type_name"),
            )
        for truck in records.apparatus.values():
            snap = truck.public_snapshot or {}
            name = str(snap.get("name") or "")
            entry(
                "apparatus_in",
                "apparatus",
                truck.id,
                snap.get("in_service_date"),
                snap.get("in_service_precision"),
                snap.get("in_service_circa"),
                f"{name} entered service",
            )
            entry(
                "apparatus_out",
                "apparatus",
                truck.id,
                snap.get("out_of_service_date"),
                snap.get("out_of_service_precision"),
                snap.get("out_of_service_circa"),
                f"{name} left service",
                detail=_DISPOSITION_TEXT.get(str(snap.get("disposition"))),
            )
        people_on = self.is_on(records.settings, TYPE_PEOPLE)
        title_names = (
            await self._title_names(records.settings.organization_id)
            if people_on
            else {}
        )
        for person in records.people.values():
            snap = person.public_snapshot or {}
            name = str(snap.get("display_name") or "")
            # The death date is in the copy only when it was set to public.
            if snap.get("is_line_of_duty_death"):
                entry(
                    "line_of_duty",
                    # The Honor Roll can be on with the people section off;
                    # then the entry names no record a website cannot open.
                    "member" if people_on else None,
                    person.id,
                    snap.get("death_date"),
                    snap.get("death_date_precision"),
                    snap.get("death_date_circa"),
                    f"{name} died in the line of duty",
                )
            if not people_on:
                continue
            for period in snap.get("service_periods") or []:
                for held in (period or {}).get("titles") or []:
                    title = title_names.get(str((held or {}).get("title_id")))
                    if title is None:
                        continue
                    entry(
                        "title",
                        "member",
                        person.id,
                        held.get("held_from_date"),
                        held.get("held_from_precision"),
                        held.get("held_from_circa"),
                        f"{name} became {title}",
                        key_suffix=f":{held.get('title_id')}",
                    )
        entries.sort(key=lambda e: (e["date"], e["kind"], e["label"], e["key"]))
        return entries

    async def decades(self, records: PublicRecords) -> list[dict[str, int]]:
        counts: dict[int, int] = {}
        for item in await self.timeline_entries(records):
            decade = item["date"].year // 10 * 10
            counts[decade] = counts.get(decade, 0) + 1
        return [{"decade": d, "count": counts[d]} for d in sorted(counts)]

    async def timeline(
        self, records: PublicRecords, decade: int
    ) -> list[dict[str, Any]]:
        return [
            e
            for e in await self.timeline_entries(records)
            if decade <= e["date"].year <= decade + 9
            or (
                e["end_date"] is not None
                and e["date"].year < decade
                and e["end_date"].year >= decade
            )
        ]

    @staticmethod
    def _on_day(entries: list[dict[str, Any]], day: date) -> list[dict[str, Any]]:
        days = set(today_days(day))
        found = [
            {**e, "years_ago": day.year - e["date"].year, "anniversary": day}
            for e in entries
            if e["precision"] == "day"
            and (e["date"].month, e["date"].day) in days
            and e["date"].year < day.year
        ]
        return sorted(found, key=lambda e: (e["date"], e["label"], e["key"]))

    async def today(self, records: PublicRecords, today: date) -> dict[str, Any]:
        """Day-precise entries on the department's date in earlier years. On a
        day with none, the anniversaries of the next seven days ("This week in
        history"); with none of those either, nothing."""
        entries = await self.timeline_entries(records)
        found = self._on_day(entries, today)
        if found:
            return {"mode": "today", "date": today, "entries": found}
        week: list[dict[str, Any]] = []
        for offset in range(1, WEEK_AHEAD_DAYS + 1):
            day = today + timedelta(days=offset)
            if (day.month, day.day) == (2, 29) and not calendar.isleap(day.year):
                continue
            week += self._on_day(entries, day)
        if week:
            return {"mode": "week", "date": today, "entries": week}
        return {"mode": "none", "date": today, "entries": []}

    # ------------------------------------------------------------------
    # Files
    # ------------------------------------------------------------------

    async def file_allowed(self, claim: links.FileClaim) -> Optional[Any]:
        """The record a signed link names, if the website may still have its
        file: public, its kind switched on (or, for a photo reached through an
        article, the article public and showing it). None otherwise."""
        settings = await self.settings(claim.organization_id)
        org = claim.organization_id
        if claim.kind == links.KIND_PHOTO:
            item = await self.db.scalar(
                select(HistoryMedia)
                .options(selectinload(HistoryMedia.files))
                .where(
                    HistoryMedia.id == claim.record_id,
                    HistoryMedia.organization_id == org,
                    HistoryMedia.publication_level == PUBLIC,
                    HistoryMedia.public_snapshot.is_not(None),
                )
            )
            if item is None:
                return None
            if claim.variant == links.VARIANT_DISPLAY and item.kind != MediaKind.PHOTO:
                return None
            if claim.context is None:
                return item if self.is_on(settings, TYPE_PHOTOS) else None
            article = await self._public_article(org, claim.context, settings)
            if article is None:
                return None
            shown = await self._article_media(article)
            return item if item.id in shown else None
        if claim.kind == links.KIND_DOCUMENT:
            if not self.is_on(settings, TYPE_DOCUMENTS):
                return None
            return await self.db.scalar(
                select(HistoryDocument)
                .options(selectinload(HistoryDocument.files))
                .where(
                    HistoryDocument.document_id == claim.record_id,
                    HistoryDocument.organization_id == org,
                    HistoryDocument.publication_level == PUBLIC,
                    HistoryDocument.public_snapshot.is_not(None),
                )
            )
        if claim.kind == links.KIND_ARTICLE:
            return await self._public_article(org, claim.record_id, settings)
        return None

    async def _public_article(
        self, organization_id: str, article_id: str, settings: HistoryPublicSettings
    ) -> Optional[HistoryArticle]:
        if not self.is_on(settings, TYPE_ARTICLES):
            return None
        return await self.db.scalar(
            select(HistoryArticle).where(
                HistoryArticle.id == str(article_id),
                HistoryArticle.organization_id == str(organization_id),
                HistoryArticle.publication_level == PUBLIC,
                HistoryArticle.public_snapshot.is_not(None),
            )
        )

    async def article_pdf_view(
        self, article: HistoryArticle
    ) -> tuple[dict[str, Any], dict[str, HistoryMedia]]:
        """The public article in the shape the phase 6 exporter prints, and
        the public photos it shows."""
        records = await self.records(article.organization_id)
        view = await self.article_view(article, records)
        media = await self._article_media(article)

        def photo(entry: Optional[dict[str, Any]]) -> Optional[dict[str, Any]]:
            return {"id": entry["id"], "title": entry["title"]} if entry else None

        blocks = [
            (
                {"kind": "text", "html": b["html"]}
                if b["kind"] == "text"
                else {
                    "kind": "photo",
                    "media": photo(b["photo"]),
                    "caption": b["caption"],
                    "size": b["size"],
                }
            )
            for b in view["blocks"]
        ]
        sources = [
            {"kind": "document", "id": d["id"], "title": d["title"]}
            for d in view["documents"]
        ] + [
            {"kind": "event", "id": e["id"], "title": e["title"]}
            for e in view["events"]
        ]
        printed = {
            "title": view["title"],
            "subtitle": view["subtitle"],
            "byline": view["byline"],
            "summary": view["summary"],
            "cover": photo(view["cover"]),
            "blocks": blocks,
            "members": [{"display_name": name} for name in view["people"]],
            "apparatus": [{"name": name} for name in view["apparatus"]],
            "sources": sources,
            "citations": view["citations"],
        }
        return printed, media
