"""History phase 7 against the database: the department's website.

Covered over HTTP, through the routers the app mounts: every part answers 404
while it is switched off or the History module is off, and 503 while the
portal is off; only public records are served, and only their cleared copy; a
link to a record that is not public, or whose part is off, is left out; the
feed's order; the timeline and "Today in history" built from the cleared
copies, with the seven-day fallback; signed file links refused when forged,
expired, withdrawn or switched off, and never naming an original; the public
article PDF holding only public photos; the widget link's checks,
replacement and embed policy; every portal call logged; and another
department's key never reaching these records.
"""

import json
from datetime import date, datetime, timedelta, timezone
from io import BytesIO

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from pypdf import PdfReader
from sqlalchemy import func, select, text

from app.api.public import history as public_history
from app.api.v1.endpoints import history_public as admin
from app.core.database import get_db
from app.core.public_portal_security import generate_api_key, hash_api_key
from app.models.history import (
    DatePrecision,
    FieldVisibility,
    HistoryMediaFile,
    MediaFileRole,
    PublicationLevel,
)
from app.models.public_portal import (
    PublicPortalAccessLog,
    PublicPortalAPIKey,
    PublicPortalConfig,
)
from app.services import history_public_links as links
from app.services.history_apparatus_service import HistoryApparatusService
from app.services.history_article_service import HistoryArticleService
from app.services.history_document_service import HistoryDocumentService
from app.services.history_event_service import HistoryEventService
from app.services.history_media_service import HistoryMediaService
from app.services.history_public_service import HistoryPublicService
from app.services.history_service import HistoryService
from tests.test_history_articles import _article, _landscape, _photo, _text
from tests.test_history_documents import _upload as _upload_document
from tests.test_history_events import _apparatus, _event, _person
from tests.test_history_media import _Dept
from tests.test_history_media import _upload as _upload_photo
from tests.test_history_module import _org, _position, _user

pytestmark = pytest.mark.integration

PUBLIC = PublicationLevel.PUBLIC
EVERYTHING = {
    "people": True,
    "honor_roll": True,
    "photos": True,
    "documents": True,
    "events": True,
    "apparatus": True,
    "articles": True,
    "timeline": True,
    "today": True,
}

_GETTERS = {
    HistoryService: "get_person",
    HistoryMediaService: "get_media",
    HistoryDocumentService: "get_document",
    HistoryEventService: "get_event",
    HistoryApparatusService: "get_apparatus",
    HistoryArticleService: "get_article",
}


@pytest.fixture
def uploads(tmp_path, monkeypatch):
    from app.services import file_storage_service

    monkeypatch.setattr(file_storage_service, "UPLOADS_ROOT", str(tmp_path))
    return tmp_path


async def _enable_modules(db, org_id, history=True) -> None:
    settings = {
        "modules": {"_user_configured": True, "public_info": True, "history": history},
        # The department's websites, from Organization Settings -> Forms: the
        # list the widget is framed from. One entry is not an origin.
        "forms": {
            "embed_allowed_origins": ["https://www.example-fd.org", "not an origin"]
        },
    }
    await db.execute(
        text("UPDATE organizations SET settings = :s WHERE id = :id"),
        {"s": json.dumps(settings), "id": org_id},
    )


class _Site:
    """A department with its portal on and a key, as a website sees it."""

    def __init__(self, dept, key, config):
        self.dept = dept
        self.key = key
        self.config = config


async def _site(db, uploads=None) -> _Site:
    org_id = await _org(db)
    historian_pos = await _position(
        db,
        org_id,
        "Historian",
        ["history.view", "history.manage", "history.publish"],
        slug=f"historian-{org_id[:6]}",
    )
    historian = await _user(db, org_id, "Hannah", historian_pos)
    member = await _user(db, org_id, "Mark")
    await _enable_modules(db, org_id)
    config = PublicPortalConfig(
        organization_id=org_id,
        enabled=True,
        # Stored but read by nothing: the widget must not take it.
        allowed_origins=["https://portal-only.example.org"],
        default_rate_limit=1000,
        cache_ttl_seconds=300,
        settings={},
    )
    db.add(config)
    await db.flush()
    raw, prefix = generate_api_key()
    db.add(
        PublicPortalAPIKey(
            organization_id=org_id,
            config_id=config.id,
            key_hash=hash_api_key(raw),
            key_prefix=prefix,
            name="Website",
            is_active=True,
        )
    )
    await db.flush()
    dept = _Dept(org_id, historian, member, historian_pos, historian)
    return _Site(dept, raw, config)


@pytest.fixture
async def site(db_session, uploads) -> _Site:
    return await _site(db_session)


@pytest.fixture
async def client(db_session):
    app = FastAPI()
    app.include_router(public_history.router, prefix="/api")
    app.include_router(public_history.open_router, prefix="/api")
    app.dependency_overrides[get_db] = lambda: db_session
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as http:
        yield http


def _api(site: _Site) -> dict:
    return {"X-API-Key": site.key}


async def _switch(db, site: _Site, **values) -> None:
    await HistoryPublicService(db).update_settings(
        site.dept.org_id, values or EVERYTHING, site.dept.actor
    )


async def _go_public(db, service_class, item, *, when=None):
    """What publishing to the public does once clearance has passed: these
    tests are about what the website is given, not the clearance list."""
    service = service_class(db)
    loaded = await getattr(service, _GETTERS[service_class])(
        item.organization_id,
        item.document_id if service_class is HistoryDocumentService else item.id,
    )
    loaded.public_snapshot = service._public_snapshot(loaded)
    loaded.public_revision_number = loaded.revision_number
    loaded.publication_level = PUBLIC
    loaded.published_at = when or datetime.now(timezone.utc)
    await db.flush()
    return loaded


async def _withdraw(db, item) -> None:
    item.publication_level = PublicationLevel.MEMBERS
    item.public_snapshot = None
    await db.flush()


class TestSwitches:
    @pytest.mark.parametrize(
        "path",
        [
            "/people",
            "/honor-roll",
            "/photos",
            "/documents",
            "/events",
            "/apparatus",
            "/articles",
            "/timeline/decades",
            "/timeline?decade=1910",
            "/today",
        ],
    )
    async def test_every_part_is_404_until_switched_on(
        self, db_session, site, client, path
    ):
        url = "/api/public/v1/history" + path
        assert (await client.get(url, headers=_api(site))).status_code == 404
        await _switch(db_session, site)
        assert (await client.get(url, headers=_api(site))).status_code == 200

    async def test_the_module_and_the_portal_gate_everything(
        self, db_session, site, client
    ):
        await _switch(db_session, site)
        url = "/api/public/v1/history/people"
        await _enable_modules(db_session, site.dept.org_id, history=False)
        assert (await client.get(url, headers=_api(site))).status_code == 404
        await _enable_modules(db_session, site.dept.org_id)
        site.config.enabled = False
        await db_session.flush()
        assert (await client.get(url, headers=_api(site))).status_code == 503

    async def test_a_key_is_required(self, db_session, site, client):
        await _switch(db_session, site)
        response = await client.get("/api/public/v1/history/people")
        assert response.status_code == 401


class TestWhatIsServed:
    async def test_only_the_cleared_copy_of_public_records(
        self, db_session, site, client
    ):
        dept = site.dept
        await _switch(db_session, site)
        shown = await _event(
            db_session, dept, title="Mill fire", research_notes="A private lead"
        )
        await _go_public(db_session, HistoryEventService, shown)
        await _event(db_session, dept, title="Never public")
        # A later edit waits for clearance; the website keeps the cleared copy.
        live = await HistoryEventService(db_session).get_event(dept.org_id, shown.id)
        await HistoryEventService(db_session).update(
            live,
            {"title": "Mill fire (draft rewrite)"},
            {},
            edit_kind="minor",
            edit_note=None,
            actor_id=dept.actor,
        )

        listed = (
            await client.get("/api/public/v1/history/events", headers=_api(site))
        ).json()
        assert listed["total"] == 1
        assert [e["title"] for e in listed["items"]] == ["Mill fire"]
        detail = (
            await client.get(
                f"/api/public/v1/history/events/{shown.id}", headers=_api(site)
            )
        ).json()
        assert detail["title"] == "Mill fire"
        assert "research_notes" not in detail
        assert "A private lead" not in str(detail)

    async def test_a_record_not_public_is_404(self, db_session, site, client):
        await _switch(db_session, site)
        person = await _person(db_session, site.dept, "Hidden")
        response = await client.get(
            f"/api/public/v1/history/people/{person.id}", headers=_api(site)
        )
        assert response.status_code == 404

    async def test_links_only_to_public_records_whose_part_is_on(
        self, db_session, site, client
    ):
        dept = site.dept
        photo = await _upload_photo(db_session, dept, name="crew.jpg")
        photo = await _go_public(db_session, HistoryMediaService, photo)
        hidden = await _upload_photo(db_session, dept, name="hidden.jpg")
        event = await _event(
            db_session, dept, links={"media_ids": [photo.id, hidden.id]}
        )
        await _go_public(db_session, HistoryEventService, event)
        url = f"/api/public/v1/history/events/{event.id}"

        await _switch(db_session, site, events=True)
        assert (await client.get(url, headers=_api(site))).json()["photos"] == []
        await _switch(db_session, site, photos=True)
        photos = (await client.get(url, headers=_api(site))).json()["photos"]
        assert [p["id"] for p in photos] == [photo.id]
        assert photos[0]["image_url"].startswith(links.FILES_PATH)

    async def test_the_honor_roll_and_a_person(self, db_session, site, client):
        dept = site.dept
        await _switch(db_session, site)
        fallen = await _person(
            db_session,
            dept,
            "Brennan",
            first_name="Tom",
            is_memorial=True,
            is_line_of_duty_death=True,
            death_date=date(1911, 3, 4),
            death_date_precision=DatePrecision.DAY,
            death_date_visibility=FieldVisibility.PUBLIC,
            biography="Joined in **1902**.",
            research_notes="Family letters",
        )
        await _go_public(db_session, HistoryService, fallen)
        roll = (
            await client.get("/api/public/v1/history/honor-roll", headers=_api(site))
        ).json()["items"]
        assert [(p["id"], p["death_date"]) for p in roll] == [(fallen.id, "1911-03-04")]
        person = (
            await client.get(
                f"/api/public/v1/history/people/{fallen.id}", headers=_api(site)
            )
        ).json()
        assert "<strong>1902</strong>" in person["biography_html"]
        assert "research_notes" not in person
        assert "birth_date" not in person

    async def test_another_departments_key_reaches_nothing(
        self, db_session, site, client
    ):
        await _switch(db_session, site)
        event = await _event(db_session, site.dept)
        await _go_public(db_session, HistoryEventService, event)
        other = await _site(db_session)
        await _switch(db_session, other)
        listed = (
            await client.get("/api/public/v1/history/events", headers=_api(other))
        ).json()
        assert listed["total"] == 0
        response = await client.get(
            f"/api/public/v1/history/events/{event.id}", headers=_api(other)
        )
        assert response.status_code == 404

    async def test_every_portal_call_is_logged(self, db_session, site, client):
        async def logged() -> list[int]:
            rows = await db_session.execute(
                select(PublicPortalAccessLog.status_code).where(
                    PublicPortalAccessLog.organization_id == site.dept.org_id
                )
            )
            return sorted(rows.scalars().all())

        await client.get("/api/public/v1/history/people", headers=_api(site))
        await _switch(db_session, site)
        await client.get("/api/public/v1/history/people", headers=_api(site))
        assert await logged() == [200, 404]


class TestFeedAndTimeline:
    async def test_the_feed_is_newest_first_and_pages_back(
        self, db_session, site, client
    ):
        dept = site.dept
        await _switch(db_session, site)
        start = datetime(2026, 11, 1, 12, tzinfo=timezone.utc)
        older = await _event(db_session, dept, title="Older")
        await _go_public(db_session, HistoryEventService, older, when=start)
        truck = await _apparatus(db_session, dept, name="Engine 1")
        await _go_public(
            db_session, HistoryApparatusService, truck, when=start + timedelta(days=1)
        )
        newest = await _event(db_session, dept, title="Newest")
        await _go_public(
            db_session, HistoryEventService, newest, when=start + timedelta(days=2)
        )

        items = (
            await client.get("/api/public/v1/history/feed", headers=_api(site))
        ).json()["items"]
        assert [(i["type"], i["title"]) for i in items] == [
            ("event", "Newest"),
            ("apparatus", "Engine 1"),
            ("event", "Older"),
        ]
        page = (
            await client.get(
                "/api/public/v1/history/feed",
                params={"before": items[1]["published_at"]},
                headers=_api(site),
            )
        ).json()["items"]
        assert [i["title"] for i in page] == ["Older"]

    async def test_a_switched_off_part_is_not_in_the_feed(
        self, db_session, site, client
    ):
        await _switch(db_session, site, apparatus=True)
        event = await _event(db_session, site.dept, title="Hidden here")
        await _go_public(db_session, HistoryEventService, event)
        items = (
            await client.get("/api/public/v1/history/feed", headers=_api(site))
        ).json()["items"]
        assert items == []

    async def test_the_honor_roll_alone_puts_no_person_in_the_feed(
        self, db_session, site, client
    ):
        await _switch(db_session, site, honor_roll=True)
        fallen = await _person(
            db_session, site.dept, "Brennan", is_line_of_duty_death=True
        )
        await _go_public(db_session, HistoryService, fallen)
        items = (
            await client.get("/api/public/v1/history/feed", headers=_api(site))
        ).json()["items"]
        assert items == []

    async def test_the_timeline_reads_the_cleared_copies(
        self, db_session, site, client
    ):
        dept = site.dept
        await _switch(db_session, site)
        event = await _event(db_session, dept, title="Mill fire")
        await _go_public(db_session, HistoryEventService, event)
        await _event(db_session, dept, title="Draft fire", start=date(1915, 1, 1))
        decades = (
            await client.get(
                "/api/public/v1/history/timeline/decades", headers=_api(site)
            )
        ).json()["items"]
        assert decades == [{"decade": 1910, "count": 1}]
        entries = (
            await client.get(
                "/api/public/v1/history/timeline",
                params={"decade": 1910},
                headers=_api(site),
            )
        ).json()["items"]
        assert [(e["label"], e["record_id"]) for e in entries] == [
            ("Mill fire", event.id)
        ]


class TestToday:
    async def _records(self, db, site):
        service = HistoryPublicService(db)
        return service, await service.records(site.dept.org_id)

    async def test_today_then_this_week_then_nothing(self, db_session, site):
        dept = site.dept
        await _switch(db_session, site)
        event = await _event(db_session, dept, title="Mill fire")
        await _go_public(db_session, HistoryEventService, event)
        # Year precision never counts as an anniversary.
        vague = await _event(
            db_session,
            dept,
            title="Some year",
            start=date(1920, 3, 1),
            start_precision=DatePrecision.YEAR,
        )
        await _go_public(db_session, HistoryEventService, vague)
        service, records = await self._records(db_session, site)

        on_the_day = await service.today(records, date(2026, 3, 4))
        assert on_the_day["mode"] == "today"
        assert [(e["label"], e["years_ago"]) for e in on_the_day["entries"]] == [
            ("Mill fire", 115)
        ]
        week = await service.today(records, date(2026, 2, 28))
        assert week["mode"] == "week"
        assert [e["label"] for e in week["entries"]] == ["Mill fire"]
        # The day each falls on, written out for the widget.
        assert [e["anniversary_label"] for e in week["entries"]] == ["March 4"]
        # The year-precision event is stored as 1 January: not an anniversary.
        assert (await service.today(records, date(2026, 1, 1)))["mode"] == "none"
        quiet = await service.today(records, date(2026, 6, 1))
        assert quiet == {"mode": "none", "date": date(2026, 6, 1), "entries": []}

    async def test_a_withdrawn_record_drops_out(self, db_session, site):
        await _switch(db_session, site)
        event = await _event(db_session, site.dept, title="Mill fire")
        event = await _go_public(db_session, HistoryEventService, event)
        await _withdraw(db_session, event)
        service, records = await self._records(db_session, site)
        assert (await service.today(records, date(2026, 3, 4)))["mode"] == "none"


class TestSignedFiles:
    async def _public_photo(self, db, site):
        photo = await _upload_photo(db, site.dept, name="parade.jpg")
        return await _go_public(db, HistoryMediaService, photo)

    async def test_a_public_photo_is_served_and_refused_once_withdrawn(
        self, db_session, site, client
    ):
        await _switch(db_session, site, photos=True)
        photo = await self._public_photo(db_session, site)
        url = links.link(site.dept.org_id, links.KIND_PHOTO, photo.id, "display")
        served = await client.get(url)
        assert served.status_code == 200
        assert served.headers["content-type"].startswith("image/")
        stored = await db_session.scalar(
            select(HistoryMediaFile).where(
                HistoryMediaFile.media_id == photo.id,
                HistoryMediaFile.role == MediaFileRole.DISPLAY,
            )
        )
        assert len(served.content) == stored.size_bytes

        await _withdraw(db_session, photo)
        assert (await client.get(url)).status_code == 404

    async def test_refused_when_forged_expired_or_switched_off(
        self, db_session, site, client
    ):
        await _switch(db_session, site, photos=True)
        photo = await self._public_photo(db_session, site)
        org = site.dept.org_id
        token = links.sign(org, links.KIND_PHOTO, photo.id, "thumbnail")
        payload, signature = token.split(".")
        forged = f"{payload}.{signature[:-2]}AA"
        assert (await client.get(links.FILES_PATH + forged)).status_code == 404
        stale = links.sign(
            org,
            links.KIND_PHOTO,
            photo.id,
            "thumbnail",
            now=datetime.now(timezone.utc) - timedelta(days=2),
        )
        assert (await client.get(links.FILES_PATH + stale)).status_code == 404
        assert (await client.get(links.FILES_PATH + token)).status_code == 200
        await _switch(db_session, site, photos=False)
        assert (await client.get(links.FILES_PATH + token)).status_code == 404
        await _switch(db_session, site, photos=True)
        site.config.enabled = False
        await db_session.flush()
        assert (await client.get(links.FILES_PATH + token)).status_code == 404

    async def test_an_original_can_never_be_named(self, db_session, site):
        photo = await self._public_photo(db_session, site)
        with pytest.raises(ValueError, match="cannot be linked"):
            links.sign(site.dept.org_id, links.KIND_PHOTO, photo.id, "original")

    async def test_a_document_file(self, db_session, site, client):
        await _switch(db_session, site, documents=True)
        paper = await _upload_document(db_session, site.dept)
        paper = await _go_public(db_session, HistoryDocumentService, paper)
        view = (
            await client.get(
                f"/api/public/v1/history/documents/{paper.document_id}",
                headers=_api(site),
            )
        ).json()
        served = await client.get(view["file_url"])
        assert served.status_code == 200
        assert served.headers["content-type"] == "application/pdf"

    async def test_the_article_pdf_holds_only_public_photos(
        self, db_session, site, client
    ):
        dept = site.dept
        await _switch(db_session, site, articles=True)
        shown = await _upload_photo(
            db_session, dept, content=_landscape("red"), name="shown.jpg"
        )
        shown = await _go_public(db_session, HistoryMediaService, shown)
        hidden = await _upload_photo(
            db_session, dept, content=_landscape("green"), name="hidden.jpg"
        )
        hidden.publication_level = PublicationLevel.MEMBERS
        await db_session.flush()
        article = await _article(
            db_session,
            dept,
            blocks=[
                _text("<p>It began at night.</p>"),
                _photo(shown, "Public"),
                _photo(hidden, "Members only"),
            ],
        )
        await _go_public(db_session, HistoryArticleService, article)

        view = (
            await client.get(
                f"/api/public/v1/history/articles/{article.id}", headers=_api(site)
            )
        ).json()
        assert [b["photo"]["id"] for b in view["blocks"] if b["kind"] == "photo"] == [
            shown.id
        ]
        # The article's own photo opens with the photo section off.
        photo_url = view["blocks"][1]["photo"]["image_url"]
        assert (await client.get(photo_url)).status_code == 200

        pdf = await client.get(view["pdf_url"])
        assert pdf.status_code == 200
        reader = PdfReader(BytesIO(pdf.content))
        text_of = "".join(page.extract_text() for page in reader.pages)
        assert "It began at night." in text_of
        assert "Public" in text_of
        assert "Members only" not in text_of
        images = sum(len(page.images) for page in reader.pages)
        assert images == 1


class TestWidget:
    async def test_the_link_checks_and_replacement(self, db_session, site, client):
        service = HistoryPublicService(db_session)
        token = await service.make_widget_token(site.dept.org_id, site.dept.actor)
        url = f"/api/public/v1/history/widget/{token}/today"
        assert (await client.get(url)).status_code == 404
        await _switch(db_session, site, today=True)
        answer = (await client.get(url)).json()
        assert answer["mode"] == "none"
        assert answer["theme"] == "auto"
        assert answer["organization_name"] == "Dept"

        replaced = await service.make_widget_token(site.dept.org_id, site.dept.actor)
        assert (await client.get(url)).status_code == 404
        fresh = f"/api/public/v1/history/widget/{replaced}/today"
        assert (await client.get(fresh)).status_code == 200
        await service.remove_widget_token(site.dept.org_id, site.dept.actor)
        assert (await client.get(fresh)).status_code == 404

    async def test_only_the_hash_is_kept(self, db_session, site):
        service = HistoryPublicService(db_session)
        token = await service.make_widget_token(site.dept.org_id, site.dept.actor)
        row = await service.settings(site.dept.org_id)
        assert row.widget_token_hash != token
        assert token not in str(row.widget_token_hash)

    async def test_branding_can_be_left_off(self, db_session, site, client):
        service = HistoryPublicService(db_session)
        token = await service.make_widget_token(site.dept.org_id, site.dept.actor)
        await _switch(db_session, site, today=True, widget_show_branding=False)
        answer = (
            await client.get(f"/api/public/v1/history/widget/{token}/today")
        ).json()
        assert answer["organization_name"] is None

    async def test_the_embed_policy(self, db_session, site, client):
        service = HistoryPublicService(db_session)
        token = await service.make_widget_token(site.dept.org_id, site.dept.actor)
        url = f"/api/public/v1/history/widget/{token}/embed-policy"
        off = await client.get(url)
        assert off.headers[public_history.EMBED_ANCESTORS_HEADER] == "'none'"
        await _switch(db_session, site, today=True)
        on = await client.get(url)
        # The stored entry that is not an https origin is dropped.
        assert on.headers[public_history.EMBED_ANCESTORS_HEADER] == (
            "https://www.example-fd.org"
        )
        unknown = await client.get(
            "/api/public/v1/history/widget/" + "x" * 43 + "/embed-policy"
        )
        assert unknown.headers[public_history.EMBED_ANCESTORS_HEADER] == "'none'"


class TestAdminSettings:
    async def test_settings_round_trip(self, db_session, site):
        dept = site.dept
        view = await admin.get_public_settings(
            db=db_session, current_user=dept.historian
        )
        assert view.people is False
        assert view.portal_enabled is True
        assert view.portal_has_key is True
        assert view.widget_link_exists is False
        assert view.widget_websites == ["https://www.example-fd.org"]

        from app.schemas.history import HistoryPublicSettingsUpdate

        updated = await admin.update_public_settings(
            HistoryPublicSettingsUpdate(people=True, widget_theme="dark"),
            db=db_session,
            current_user=dept.historian,
        )
        assert (updated.people, updated.photos, updated.widget_theme) == (
            True,
            False,
            "dark",
        )
        link = await admin.make_widget_link(db=db_session, current_user=dept.historian)
        assert len(link.token) >= 32
        view = await admin.get_public_settings(
            db=db_session, current_user=dept.historian
        )
        assert view.widget_link_exists is True
        count = await db_session.scalar(
            select(func.count()).select_from(PublicPortalAccessLog)
        )
        assert count is not None
