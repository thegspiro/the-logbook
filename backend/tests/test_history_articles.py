"""History phase 6 against the database: articles and their PDF and Word
exports.

Covered: who reads what (drafts, photos and links to records a member cannot
open, the research notes); the editor's view keeping a withdrawn photo as a
gap; every client-sent id checked against the department, and a recording
refused as a photo; text blocks sanitized; body and link edits recorded as
substantial while an omitted set stays; search over the text; the clearance
refusal while the article shows a photo that is not public; the public copy;
a person merge carrying article links; and each export holding exactly the
page its reader could read.
"""

from io import BytesIO

import pytest
from docx import Document as WordDocument
from PIL import Image
from pypdf import PdfReader
from sqlalchemy import select

from app.models.history import (
    ArticlePhotoSize,
    ClearancePurpose,
    HistoryMedia,
    HistoryMediaFile,
    MediaFileRole,
    MediaKind,
    PublicationLevel,
)
from app.services.history_article_export import (
    PREPARED_BY,
    ExportMeta,
    load_photos,
    render_article_docx,
    render_article_pdf,
)
from app.services.history_article_service import HistoryArticleService
from app.services.history_clearance_service import HistoryClearanceService
from app.services.history_merge_service import HistoryMergeService
from tests.test_history_documents import _upload as _upload_document
from tests.test_history_events import _apparatus, _event, _person, _publish_person
from tests.test_history_media import _Dept
from tests.test_history_media import _upload as _upload_photo
from tests.test_history_module import _org, _position, _user

pytestmark = pytest.mark.integration

MEMBERS = PublicationLevel.MEMBERS
PUBLIC = PublicationLevel.PUBLIC


@pytest.fixture
def uploads(tmp_path, monkeypatch):
    from app.services import file_storage_service

    monkeypatch.setattr(file_storage_service, "UPLOADS_ROOT", str(tmp_path))
    return tmp_path


@pytest.fixture
async def dept(db_session, uploads):
    org_id = await _org(db_session)
    historian_pos = await _position(
        db_session,
        org_id,
        "Historian",
        ["history.view", "history.manage", "history.publish"],
        slug="historian",
    )
    president_pos = await _position(db_session, org_id, "President", [])
    historian = await _user(db_session, org_id, "Hannah", historian_pos)
    member = await _user(db_session, org_id, "Mark")
    president = await _user(db_session, org_id, "Pat", president_pos)
    return _Dept(org_id, historian, member, president_pos, president)


@pytest.fixture
async def other_dept(db_session):
    org_id = await _org(db_session)
    historian_pos = await _position(
        db_session, org_id, "Historian", ["history.view", "history.manage"]
    )
    historian = await _user(db_session, org_id, "Olga", historian_pos)
    return _Dept(org_id, historian, historian, historian_pos, historian)


def _landscape(colour: str) -> bytes:
    # Each photo its own colour: a PDF stores identical images once.
    out = BytesIO()
    Image.new("RGB", (1200, 600), colour).save(out, "JPEG")
    return out.getvalue()


def _text(html: str) -> dict:
    return {"kind": "text", "html": html}


def _photo(media, caption=None, size="full") -> dict:
    return {"kind": "photo", "media_id": media.id, "caption": caption, "size": size}


async def _article(db, dept, title="The mill fire", blocks=None, links=None, **v):
    return await HistoryArticleService(db).create(
        dept.org_id,
        {"title": title, **v},
        blocks if blocks is not None else [_text("<p>It began at night.</p>")],
        links or {},
        dept.actor,
        "Hannah Historian",
    )


async def _level(db, item, level) -> None:
    """Set a record's level directly: these tests are about the article, not
    how each photo or record was cleared."""
    item.publication_level = level
    await db.flush()


async def _fresh(db, dept, article):
    return await HistoryArticleService(db).get_article(dept.org_id, article.id)


async def _update(db, item, values=None, blocks=None, links=None, kind="minor"):
    return await HistoryArticleService(db).update(
        item,
        values or {},
        blocks,
        links or {},
        edit_kind=kind,
        edit_note=None,
        actor_id=str(item.created_by),
    )


class TestReading:
    async def test_a_member_sees_only_what_they_could_open(self, db_session, dept):
        shown_photo = await _upload_photo(db_session, dept, name="shown.jpg")
        hidden_photo = await _upload_photo(db_session, dept, name="hidden.jpg")
        await _level(db_session, shown_photo, MEMBERS)
        shown = await _person(db_session, dept, "Shown")
        await _publish_person(db_session, dept, shown)
        hidden = await _person(db_session, dept, "Hidden")
        truck = await _apparatus(db_session, dept)
        event = await _event(db_session, dept)
        paper = await _upload_document(db_session, dept)
        service = HistoryArticleService(db_session)
        article = await _article(
            db_session,
            dept,
            blocks=[
                _text("<p>It began at night.</p>"),
                _photo(shown_photo, "The ruins"),
                _photo(hidden_photo, "The crew"),
            ],
            links={
                "member_ids": [shown.id, hidden.id],
                "event_ids": [event.id],
                "apparatus_ids": [truck.id],
                "document_ids": [paper.document_id],
            },
            cover_media_id=hidden_photo.id,
            research_notes="Mrs Jones, a neighbour, told me in 1990",
        )
        await service.publish(article, MEMBERS, dept.actor)
        seen = await service.get_readable_article(dept.reader, article.id)
        view = service.member_view(dept.reader, seen)
        assert [b["kind"] for b in view["blocks"]] == ["text", "photo"]
        assert view["blocks"][1]["media"]["id"] == shown_photo.id
        assert view["blocks"][1]["caption"] == "The ruins"
        assert view["cover"] is None
        assert view["members"] == [{"member_id": shown.id, "display_name": "Shown"}]
        assert view["events"] == view["apparatus"] == view["documents"] == []
        assert view["sources"] == [
            {"kind": "photo", "id": shown_photo.id, "title": shown_photo.title}
        ]
        assert "research_notes" not in view

        full = service.full_view(
            dept.keeper, seen, None, clearance_required=False, cleared_for_public=False
        )
        assert len(full["blocks"]) == 3
        assert full["cover"]["id"] == hidden_photo.id
        assert {m["member_id"] for m in full["members"]} == {shown.id, hidden.id}
        assert full["research_notes"].startswith("Mrs Jones")

    async def test_a_draft_article_is_hidden_from_members(self, db_session, dept):
        article = await _article(db_session, dept)
        service = HistoryArticleService(db_session)
        assert await service.get_readable_article(dept.reader, article.id) is None
        assert await service.get_readable_article(dept.keeper, article.id)
        found, total = await service.list_articles(dept.reader)
        assert (found, total) == ([], 0)

    async def test_the_editor_keeps_a_deleted_photo_as_a_gap(self, db_session, dept):
        photo = await _upload_photo(db_session, dept)
        article = await _article(
            db_session, dept, blocks=[_photo(photo, "Gone"), _text("<p>Text</p>")]
        )
        await db_session.delete(await db_session.get(HistoryMedia, photo.id))
        await db_session.flush()
        service = HistoryArticleService(db_session)
        article = await _fresh(db_session, dept, article)
        full = service.full_view(
            dept.keeper,
            article,
            None,
            clearance_required=False,
            cleared_for_public=False,
        )
        assert [(b["kind"], b["media"], b["caption"]) for b in full["blocks"]] == [
            ("photo", None, "Gone"),
            ("text", None, None),
        ]
        assert [
            b["kind"] for b in service.export_view(dept.keeper, article)["blocks"]
        ] == ["text"]

    async def test_another_department_cannot_read_it(
        self, db_session, dept, other_dept
    ):
        article = await _article(db_session, dept)
        service = HistoryArticleService(db_session)
        assert await service.get_article(other_dept.org_id, article.id) is None
        found, _ = await service.list_articles(other_dept.keeper)
        assert found == []


class TestWriting:
    async def test_text_is_sanitized_and_an_empty_block_dropped(self, db_session, dept):
        article = await _article(
            db_session,
            dept,
            blocks=[
                _text('<p onclick="x()">Hi<script>alert(1)</script></p>'),
                _text('<p><img src="x" onerror="alert(1)">Bye</p>'),
                _text("<p></p>"),
            ],
        )
        html = [b.html for b in article.blocks]
        assert html == ["<p>Hi</p>", "<p>Bye</p>"]

    async def test_a_text_block_too_long_is_refused(self, db_session, dept):
        with pytest.raises(ValueError, match="too long"):
            await _article(
                db_session, dept, blocks=[_text("<p>" + "a" * 100_001 + "</p>")]
            )

    async def test_every_id_is_checked_against_the_department(
        self, db_session, dept, other_dept
    ):
        their_photo = await _upload_photo(db_session, other_dept)
        theirs = await _person(db_session, other_dept, "Theirs")
        their_event = await _event(db_session, other_dept)
        their_truck = await _apparatus(db_session, other_dept)
        for kwargs, message in (
            ({"blocks": [_photo(their_photo)]}, "not a photo in this department"),
            ({"cover_media_id": their_photo.id}, "not a photo in this department"),
            ({"links": {"member_ids": [theirs.id]}}, "linked person"),
            ({"links": {"event_ids": [their_event.id]}}, "linked event"),
            ({"links": {"apparatus_ids": [their_truck.id]}}, "tagged apparatus"),
        ):
            with pytest.raises(ValueError, match=message):
                await _article(db_session, dept, **kwargs)

    async def test_a_recording_is_not_a_photo(self, db_session, dept):
        photo = await _upload_photo(db_session, dept)
        photo.kind = MediaKind.AUDIO
        await db_session.flush()
        with pytest.raises(ValueError, match="not a photo"):
            await _article(db_session, dept, blocks=[_photo(photo)])

    async def test_the_byline_defaults_to_the_writer_and_may_be_cleared(
        self, db_session, dept
    ):
        article = await _article(db_session, dept)
        assert article.byline == "Hannah Historian"
        by_retiree = await _article(db_session, dept, byline="Chief W. Grant (ret.)")
        assert by_retiree.byline == "Chief W. Grant (ret.)"
        article = await _update(db_session, article, {"byline": None})
        assert article.byline is None

    async def test_body_and_link_edits_are_substantial_and_omitted_sets_stay(
        self, db_session, dept
    ):
        person = await _person(db_session, dept)
        article = await _article(
            db_session, dept, links={"member_ids": [person.id]}, citations=["A book"]
        )
        article = await _update(db_session, article, {"research_notes": "Asked"})
        assert article.substantial_revision_number == 1
        assert [m.member_id for m in article.members] == [person.id]
        assert [b.html for b in article.blocks] == ["<p>It began at night.</p>"]
        article = await _update(
            db_session,
            article,
            blocks=[_text("<p>Second</p>"), _text("<p>First</p>")],
        )
        assert article.substantial_revision_number == article.revision_number == 3
        assert [b.html for b in article.blocks] == ["<p>Second</p>", "<p>First</p>"]
        article = await _update(db_session, article, links={"member_ids": []})
        assert article.members == []
        assert article.substantial_revision_number == 4
        article = await _update(db_session, article, {"citations": ["  ", "A book"]})
        assert article.citations == ["A book"]
        assert article.substantial_revision_number == 4

    async def test_search_reads_the_text_and_filters_by_what_it_links(
        self, db_session, dept
    ):
        photo = await _upload_photo(db_session, dept)
        person = await _person(db_session, dept)
        await _article(
            db_session,
            dept,
            title="Engine company",
            blocks=[_text("<p>The <b>Ahrens-Fox</b> pumper arrived in 1924.</p>")],
            links={"member_ids": [person.id]},
        )
        await _article(db_session, dept, title="Parade", cover_media_id=photo.id)
        service = HistoryArticleService(db_session)
        for query, titles in (
            ({"search": "ahrens"}, ["Engine company"]),
            ({"search": "_"}, []),
            ({"member_id": person.id}, ["Engine company"]),
            ({"media_id": photo.id}, ["Parade"]),
            ({"sort": "title"}, ["Engine company", "Parade"]),
        ):
            found, _ = await service.list_articles(dept.keeper, **query)
            assert [a.title for a in found] == titles, query

    async def test_deleting_an_article_leaves_what_it_showed(self, db_session, dept):
        photo = await _upload_photo(db_session, dept)
        person = await _person(db_session, dept)
        article = await _article(
            db_session,
            dept,
            blocks=[_photo(photo)],
            links={"member_ids": [person.id]},
        )
        service = HistoryArticleService(db_session)
        await service.publish(article, MEMBERS, dept.actor)
        with pytest.raises(ValueError, match="Unpublish"):
            await service.delete(article)
        await service.unpublish(article, PublicationLevel.DRAFT, dept.actor)
        await service.delete(article)
        assert await db_session.get(HistoryMedia, photo.id) is not None
        assert await service.get_article(dept.org_id, article.id) is None


class TestPublishing:
    async def test_public_clearance_waits_for_every_photo_to_be_public(
        self, db_session, dept
    ):
        clearance = HistoryClearanceService(db_session)
        await clearance.replace_steps(
            dept.org_id,
            [{"name": "President", "position_id": dept.president_position}],
        )
        cover = await _upload_photo(db_session, dept, name="cover.jpg")
        inside = await _upload_photo(db_session, dept, name="inside.jpg")
        article = await _article(
            db_session,
            dept,
            blocks=[_photo(inside, "Inside")],
            cover_media_id=cover.id,
        )
        with pytest.raises(ValueError, match=inside.title):
            await clearance.submit(article, ClearancePurpose.PUBLIC, dept.actor)
        # Review is not public clearance, and is never refused for this.
        request, _ = await clearance.submit(
            article, ClearancePurpose.REVIEW, dept.actor
        )
        assert request.record_type == "article"
        await _level(db_session, inside, PUBLIC)
        await _level(db_session, cover, PUBLIC)
        article = await _fresh(db_session, dept, article)
        assert HistoryArticleService.photos_not_public(article) == []
        request, _ = await clearance.submit(
            article, ClearancePurpose.PUBLIC, dept.actor
        )
        assert request.record_type == "article"

    async def test_the_public_copy_keeps_only_what_is_public(self, db_session, dept):
        public_photo = await _upload_photo(db_session, dept, name="public.jpg")
        member_photo = await _upload_photo(db_session, dept, name="member.jpg")
        await _level(db_session, public_photo, PUBLIC)
        await _level(db_session, member_photo, MEMBERS)
        article = await _article(
            db_session,
            dept,
            blocks=[_photo(public_photo), _photo(member_photo), _text("<p>Words</p>")],
            cover_media_id=member_photo.id,
            research_notes="Private",
        )
        article = await _fresh(db_session, dept, article)
        snapshot = HistoryArticleService(db_session)._public_snapshot(article)
        assert "research_notes" not in snapshot
        assert snapshot["cover_media_id"] is None
        assert [(b["kind"], b["media_id"]) for b in snapshot["blocks"]] == [
            ("photo", public_photo.id),
            ("text", None),
        ]


class TestPersonMerge:
    async def test_article_links_follow_the_kept_person(self, db_session, dept):
        keep = await _person(db_session, dept, "Smith", first_name="John")
        other = await _person(db_session, dept, "Smith", first_name="J.")
        both = await _article(
            db_session, dept, title="Both", links={"member_ids": [keep.id, other.id]}
        )
        only_other = await _article(
            db_session, dept, title="Only other", links={"member_ids": [other.id]}
        )
        await HistoryMergeService(db_session).merge(
            dept.org_id, keep.id, other.id, {"first_name": "keep"}, dept.actor
        )
        both = await _fresh(db_session, dept, both)
        only_other = await _fresh(db_session, dept, only_other)
        assert [m.member_id for m in both.members] == [keep.id]
        assert [m.member_id for m in only_other.members] == [keep.id]


async def _export(db, dept, viewer, article_id, fmt):
    service = HistoryArticleService(db)
    item = await service.get_readable_article(viewer, article_id)
    view = service.export_view(viewer, item)
    meta = ExportMeta(
        org_name="Smallville Fire Department",
        logo=None,
        generated_on="November 23, 2026",
        photos=await load_photos(item, view),
    )
    return (render_article_pdf if fmt == "pdf" else render_article_docx)(view, meta)


def _pdf_text_and_images(content: bytes) -> tuple[str, int]:
    reader = PdfReader(BytesIO(content))
    text = "\n".join(page.extract_text() or "" for page in reader.pages)
    images = sum(len(page.images) for page in reader.pages)
    return text, images


def _docx_text_and_images(content: bytes) -> tuple[str, int]:
    document = WordDocument(BytesIO(content))
    parts = [p.text for p in document.paragraphs]
    parts += [p.text for p in document.sections[0].footer.paragraphs]
    parts += [p.text for p in document.sections[0].header.paragraphs]
    return "\n".join(parts), len(document.inline_shapes)


class TestExport:
    @pytest.fixture
    async def article(self, db_session, dept):
        # Landscape, so its printed width is set by the column, not the
        # height cap, and half width is visibly half.
        shown = await _upload_photo(
            db_session, dept, content=_landscape("gray"), name="shown.jpg"
        )
        hidden = await _upload_photo(
            db_session, dept, content=_landscape("navy"), name="hidden.jpg"
        )
        await _level(db_session, shown, MEMBERS)
        article = await _article(
            db_session,
            dept,
            subtitle="Fire on Mill Street, 1911",
            summary="How the department met its largest fire.",
            blocks=[
                _text(
                    "<h2>The alarm</h2><p>It began at <b>night</b>, see "
                    '<a href="https://example.org/mill">the report</a>.</p>'
                    "<ul><li>Engine 1</li><li>Hose 2</li></ul>"
                ),
                _photo(shown, "The ruins next morning", size="half"),
                _photo(hidden, "Unpublished crew photo"),
            ],
            citations=["The Smallville Courier, 5 March 1911"],
            research_notes="NOT FOR PRINT: Mrs Jones",
        )
        await HistoryArticleService(db_session).publish(article, MEMBERS, dept.actor)
        return article

    @pytest.mark.parametrize("fmt", ["pdf", "docx"])
    async def test_a_members_file_holds_their_page_and_no_more(
        self, db_session, dept, article, fmt
    ):
        content = await _export(db_session, dept, dept.reader, article.id, fmt)
        read = _pdf_text_and_images if fmt == "pdf" else _docx_text_and_images
        text, images = read(content)
        for expected in (
            "The mill fire",
            "Fire on Mill Street, 1911",
            "By Hannah Historian",
            "The alarm",
            "Engine 1",
            "The ruins next morning",
            "The Smallville Courier, 5 March 1911",
            PREPARED_BY,
            "November 23, 2026",
        ):
            assert expected in text, expected
        assert "Smallville Fire Department" in text
        assert "Unpublished crew photo" not in text
        assert "NOT FOR PRINT" not in text
        assert images == 1

    @pytest.mark.parametrize("fmt", ["pdf", "docx"])
    async def test_a_keepers_file_shows_every_photo(
        self, db_session, dept, article, fmt
    ):
        content = await _export(db_session, dept, dept.keeper, article.id, fmt)
        read = _pdf_text_and_images if fmt == "pdf" else _docx_text_and_images
        text, images = read(content)
        assert "Unpublished crew photo" in text
        assert "NOT FOR PRINT" not in text
        assert images == 2

    async def test_a_photo_whose_file_is_lost_prints_a_note(
        self, db_session, dept, article
    ):
        stored = await db_session.scalars(
            select(HistoryMediaFile).where(
                HistoryMediaFile.role == MediaFileRole.DISPLAY
            )
        )
        for row in stored:
            row.file_path = "history-media/missing.webp"
        await db_session.flush()
        content = await _export(db_session, dept, dept.keeper, article.id, "pdf")
        text, images = _pdf_text_and_images(content)
        assert text.count("(Photo not available)") == 2
        assert images == 0

    async def test_a_half_width_photo_prints_narrower(self, db_session, dept, article):
        service = HistoryArticleService(db_session)
        item = await service.get_readable_article(dept.keeper, article.id)
        assert [b.size for b in item.blocks if b.media_id] == [
            ArticlePhotoSize.HALF,
            ArticlePhotoSize.FULL,
        ]
        content = await _export(db_session, dept, dept.keeper, article.id, "docx")
        widths = [s.width for s in WordDocument(BytesIO(content)).inline_shapes]
        assert widths[0] < widths[1]
