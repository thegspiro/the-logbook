"""History documents against the database.

A document is a Documents-module row in the protected History folder, its
catalogue beside it (phase 1 decision). Covered here: an upload's original
kept byte for byte while everyone else reads a stripped copy; who reads what;
search over every field; albums that mix photos and documents; a person merge
carrying tags; delete removing the Documents row and every file; the
Documents module refusing to change, move into or upload into History; and
nothing reaching across departments.
"""

import io
import os
import uuid

import pytest
from fastapi import HTTPException
from PIL import Image
from pypdf import PdfReader, PdfWriter
from pypdf.generic import DictionaryObject, NameObject, TextStringObject
from reportlab.pdfgen import canvas
from sqlalchemy import select
from starlette.datastructures import UploadFile

from app.api.v1.endpoints import documents as documents_endpoint
from app.api.v1.endpoints import history_documents as endpoint
from app.models.document import (
    HISTORY_DOCUMENT_SOURCE_TYPE,
    HISTORY_FOLDER_PERMISSIONS,
    Document,
    DocumentFolder,
)
from app.models.history import (
    ClearancePurpose,
    DocumentKind,
    HistoryDocument,
    HistoryDocumentTag,
    HistoryDocumentType,
    MediaFileRole,
    PublicationLevel,
)
from app.schemas.documents import DocumentUpdate as DocumentsModuleUpdate
from app.services import file_storage_service
from app.services.documents_service import DocumentsService
from app.services.history_clearance_service import HistoryClearanceService
from app.services.history_collection_service import (
    HistoryAlbumService,
    HistoryDocumentTypeService,
)
from app.services.history_document_service import HistoryDocumentService
from app.services.history_merge_service import HistoryMergeService
from app.services.history_service import HistoryService
from tests.test_history_media import _body, _Dept, _jpeg, _request
from tests.test_history_media import _upload as _upload_photo
from tests.test_history_module import _org, _position, _user

pytestmark = pytest.mark.integration


@pytest.fixture
def uploads(tmp_path, monkeypatch):
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


def _letter(*pages: str, author: str = "Chief Smith") -> bytes:
    """A letter carrying author metadata and a document-level script."""
    out = io.BytesIO()
    page = canvas.Canvas(out)
    page.setAuthor(author)
    for text in pages:
        page.drawString(72, 750, text)
        page.showPage()
    page.save()
    writer = PdfWriter(clone_from=PdfReader(io.BytesIO(out.getvalue())))
    writer._root_object[NameObject("/OpenAction")] = writer._add_object(
        DictionaryObject(
            {
                NameObject("/S"): NameObject("/JavaScript"),
                NameObject("/JS"): TextStringObject("app.alert(1)"),
            }
        )
    )
    signed = io.BytesIO()
    writer.write(signed)
    return signed.getvalue()


async def _upload(db, dept, content=None, name="letter.pdf", **values):
    item, _ = await HistoryDocumentService(db).store_document_upload(
        dept.org_id,
        content=content if content is not None else _letter("Dear Chief,"),
        filename=name,
        values=values,
        batch_id=None,
        actor=dept.historian,
    )
    return item


def _stored_files(root) -> list[str]:
    return sorted(
        os.path.join(d, f)
        for d, _dirs, names in os.walk(root)
        for f in names
        if "history-media" in d or os.sep + "documents" + os.sep in d + os.sep
    )


async def _bytes(path: str) -> bytes:
    return await file_storage_service.read_bytes(path)


async def _derived(service, item, role) -> bytes:
    return await _bytes(service.file_of(item, role).file_path)


async def _publish(db, dept, item):
    return await HistoryDocumentService(db).publish(
        item, PublicationLevel.MEMBERS, dept.actor
    )


class TestUpload:
    async def test_the_original_is_filed_in_history_and_readers_get_a_stripped_copy(
        self, db_session, dept
    ):
        content = _letter("Dear Chief, the parade starts at noon.")
        item = await _upload(db_session, dept, content, title="Parade letter")
        service = HistoryDocumentService(db_session)

        assert item.kind == DocumentKind.PDF
        assert item.page_count == 1
        assert "parade starts at noon" in item.extracted_text
        original = item.document
        assert original.source_type == HISTORY_DOCUMENT_SOURCE_TYPE
        assert original.name == "Parade letter"
        assert await _bytes(original.file_path) == content
        folder = await db_session.get(DocumentFolder, original.folder_id)
        assert folder.slug == "history"
        assert folder.is_system is True
        assert folder.required_permissions == HISTORY_FOLDER_PERMISSIONS

        shown = await _derived(service, item, MediaFileRole.DISPLAY)
        assert b"Chief Smith" not in shown
        assert b"JavaScript" not in shown
        preview = Image.open(
            io.BytesIO(await _derived(service, item, MediaFileRole.THUMBNAIL))
        )
        assert preview.format == "WEBP"

    async def test_every_upload_uses_the_one_history_folder(self, db_session, dept):
        first = await _upload(db_session, dept)
        second = await _upload(db_session, dept)
        assert first.document.folder_id == second.document.folder_id
        roots = (
            await db_session.execute(
                select(DocumentFolder).where(
                    DocumentFolder.organization_id == dept.org_id,
                    DocumentFolder.slug == "history",
                )
            )
        ).scalars()
        assert len(list(roots)) == 1

    async def test_a_scan_is_shown_as_a_stripped_webp(self, db_session, dept):
        item = await _upload(db_session, dept, _jpeg(), "page.jpg")
        service = HistoryDocumentService(db_session)
        assert item.kind == DocumentKind.IMAGE
        assert item.page_count == 1
        shown = Image.open(
            io.BytesIO(await _derived(service, item, MediaFileRole.DISPLAY))
        )
        assert shown.format == "WEBP"
        assert dict(shown.getexif()) == {}

    async def test_a_word_file_is_refused_and_nothing_is_stored(
        self, db_session, dept, uploads
    ):
        with pytest.raises(ValueError, match="Convert Word"):
            await _upload(db_session, dept, b"PK\x03\x04", "letter.docx")
        assert _stored_files(uploads) == []

    async def test_a_password_protected_pdf_leaves_nothing_behind(
        self, db_session, dept, uploads
    ):
        writer = PdfWriter(clone_from=PdfReader(io.BytesIO(_letter("x"))))
        writer.encrypt("secret")
        out = io.BytesIO()
        writer.write(out)
        with pytest.raises(ValueError, match="password-protected"):
            await _upload(db_session, dept, out.getvalue())
        assert _stored_files(uploads) == []

    async def test_the_endpoint_answers_400_for_an_unreadable_pdf(
        self, db_session, dept
    ):
        upload = UploadFile(io.BytesIO(b"%PDF-1.4 broken"), filename="letter.pdf")
        with pytest.raises(HTTPException) as caught:
            await endpoint.upload_document(
                file=upload,
                catalogue="{}",
                batch_id=None,
                db=db_session,
                current_user=dept.historian,
            )
        assert caught.value.status_code in (400, 422)

    async def test_the_catalogue_is_stored(self, db_session, dept):
        types = HistoryDocumentTypeService(db_session)
        rows = await types.list_types(dept.org_id, include_retired=False)
        letter = next(entry for entry, _ in rows if entry.name == "Letter")
        person = await HistoryService(db_session).create_person(
            dept.org_id, {"last_name": "Smith"}, dept.actor
        )
        item = await _upload(
            db_session,
            dept,
            title="Letter of thanks",
            document_type_id=letter.id,
            author="Mayor Jones",
            recipient="Chief Smith",
            transcription="Dear Chief, thank you for the parade.",
            research_notes="Found in the attic",
            tag_member_ids=[person.id],
        )
        assert item.document_type.name == "Letter"
        assert (item.author, item.recipient) == ("Mayor Jones", "Chief Smith")
        assert item.research_notes == "Found in the attic"
        assert [t.member_id for t in item.tags] == [person.id]

    async def test_another_departments_type_or_person_is_refused(
        self, db_session, dept
    ):
        other = await _org(db_session)
        rows = await HistoryDocumentTypeService(db_session).list_types(
            other, include_retired=False
        )
        with pytest.raises(ValueError, match="document type"):
            await _upload(db_session, dept, document_type_id=rows[0][0].id)
        stranger = await HistoryService(db_session).create_person(
            other, {"last_name": "Elsewhere"}, dept.actor
        )
        with pytest.raises(ValueError, match="tagged person"):
            await _upload(db_session, dept, tag_member_ids=[stranger.id])


class TestWhoReadsWhat:
    async def test_a_draft_is_for_the_keepers(self, db_session, dept):
        item = await _upload(db_session, dept)
        service = HistoryDocumentService(db_session)
        assert await service.get_readable_document(dept.reader, item.id) is None
        assert await service.get_readable_document(dept.keeper, item.id) is not None
        await _publish(db_session, dept, item)
        assert await service.get_readable_document(dept.reader, item.id) is not None

    async def test_a_member_view_has_no_research_notes_or_original(
        self, db_session, dept
    ):
        item = await _upload(db_session, dept, research_notes="Private lead")
        view = HistoryDocumentService(db_session).member_view(dept.reader, item)
        assert "research_notes" not in view
        assert "original_filename" not in view

    async def test_view_is_never_the_original(self, db_session, dept):
        content = _letter("Dear Chief,")
        item = await _upload(db_session, dept, content)
        await _publish(db_session, dept, item)
        response = await endpoint.document_view_file(
            document_id=item.id,
            request=_request(),
            db=db_session,
            current_user=dept.member,
        )
        body = await _body(response)
        assert body != content
        assert b"Chief Smith" not in body
        assert response.headers["content-type"] == "application/pdf"
        assert response.headers["content-disposition"].startswith("inline")
        assert response.headers["x-content-type-options"] == "nosniff"
        assert "letter" not in response.headers["content-disposition"]

    async def test_the_original_downloads_as_an_attachment(self, db_session, dept):
        content = _letter("Dear Chief,")
        item = await _upload(db_session, dept, content)
        response = await endpoint.document_original(
            document_id=item.id,
            request=_request(),
            db=db_session,
            current_user=dept.historian,
        )
        assert await _body(response) == content
        assert response.headers["content-disposition"].startswith("attachment")

    async def test_the_original_route_requires_history_manage(self):
        route = next(
            r
            for r in endpoint.router.routes
            if getattr(r, "path", "") == "/documents/{document_id}/original"
        )
        checkers = [
            d.call.required_permissions
            for d in route.dependant.dependencies
            if hasattr(d.call, "required_permissions")
        ]
        assert checkers == [["history.manage"]]

    async def test_another_department_cannot_reach_a_document(self, db_session, dept):
        item = await _upload(db_session, dept)
        other = await _org(db_session)
        assert (
            await HistoryDocumentService(db_session).get_document(other, item.id)
            is None
        )


class TestSearch:
    @pytest.mark.parametrize(
        ("query", "found"),
        [
            ("parade starts", True),  # the PDF's own text
            ("thank you for the engine", True),  # the transcription
            ("Mayor Jones", True),  # the author
            ("Chief Brown", True),  # the recipient
            ("nothing like this", False),
            # A wildcard is a character, not "everything" (pitfall #25).
            ("%", False),
        ],
    )
    async def test_every_field_is_searched(self, db_session, dept, query, found):
        await _upload(
            db_session,
            dept,
            _letter("Dear Chief, the parade starts at noon."),
            author="Mayor Jones",
            recipient="Chief Brown",
            transcription="Dear Chief, thank you for the engine.",
        )
        items, total = await HistoryDocumentService(db_session).list_documents(
            dept.keeper, search=query
        )
        assert (total == 1) is found

    async def test_members_search_only_what_is_published(self, db_session, dept):
        await _upload(db_session, dept, _letter("Hidden draft text"))
        _, total = await HistoryDocumentService(db_session).list_documents(
            dept.reader, search="Hidden draft"
        )
        assert total == 0


class TestAlbums:
    async def test_an_album_interleaves_photos_and_documents(self, db_session, dept):
        photo = await _upload_photo(db_session, dept)
        paper = await _upload(db_session, dept)
        albums = HistoryAlbumService(db_session)
        album = await albums.create_album(dept.org_id, {"name": "Parade"}, dept.actor)
        await albums.set_entries(album, [("document", paper.id), ("media", photo.id)])
        entries = await albums.album_entries(dept.keeper, album)
        assert [(kind, item.id) for kind, item in entries] == [
            ("document", paper.id),
            ("media", photo.id),
        ]

    async def test_the_photo_only_call_keeps_the_documents(self, db_session, dept):
        photo = await _upload_photo(db_session, dept)
        paper = await _upload(db_session, dept)
        albums = HistoryAlbumService(db_session)
        album = await albums.create_album(dept.org_id, {"name": "Parade"}, dept.actor)
        await albums.set_entries(album, [("media", photo.id), ("document", paper.id)])
        await albums.set_items(album, [photo.id])
        entries = await albums.album_entries(dept.keeper, album)
        assert [kind for kind, _ in entries] == ["media", "document"]

    async def test_a_member_sees_only_published_documents_in_an_album(
        self, db_session, dept
    ):
        shown = await _upload(db_session, dept)
        hidden = await _upload(db_session, dept)
        await _publish(db_session, dept, shown)
        albums = HistoryAlbumService(db_session)
        album = await albums.create_album(
            dept.org_id, {"name": "Parade", "level": "members"}, dept.actor
        )
        await albums.set_entries(
            album, [("document", shown.id), ("document", hidden.id)]
        )
        entries = await albums.album_entries(dept.reader, album)
        assert [item.id for _, item in entries] == [shown.id]

    async def test_another_departments_document_is_refused(self, db_session, dept):
        albums = HistoryAlbumService(db_session)
        album = await albums.create_album(dept.org_id, {"name": "A"}, dept.actor)
        with pytest.raises(ValueError, match="document"):
            await albums.set_entries(album, [("document", str(uuid.uuid4()))])


class TestPeopleAndMerge:
    async def test_a_merge_carries_document_tags(self, db_session, dept):
        history = HistoryService(db_session)
        keep = await history.create_person(
            dept.org_id, {"last_name": "Smith"}, dept.actor
        )
        other = await history.create_person(
            dept.org_id, {"last_name": "Smith"}, dept.actor
        )
        both = await _upload(db_session, dept, tag_member_ids=[keep.id, other.id])
        only = await _upload(db_session, dept, tag_member_ids=[other.id])

        await HistoryMergeService(db_session).merge(
            dept.org_id, keep.id, other.id, {}, dept.actor
        )

        tags = (
            await db_session.execute(
                select(HistoryDocumentTag.document_id, HistoryDocumentTag.member_id)
            )
        ).all()
        assert sorted(tags) == sorted([(both.id, keep.id), (only.id, keep.id)])


class TestDelete:
    async def test_a_draft_goes_with_its_documents_row_and_every_file(
        self, db_session, dept, uploads
    ):
        item = await _upload(db_session, dept)
        document_id = item.id
        assert len(_stored_files(uploads)) == 3
        refs = await HistoryDocumentService(db_session).delete(item)
        for ref in refs:
            await file_storage_service.delete_quietly(ref)
        assert await db_session.get(Document, document_id) is None
        assert await db_session.get(HistoryDocument, document_id) is None
        assert _stored_files(uploads) == []

    async def test_a_published_document_is_not_deleted(self, db_session, dept):
        item = await _upload(db_session, dept)
        await _publish(db_session, dept, item)
        with pytest.raises(ValueError, match="Unpublish"):
            await HistoryDocumentService(db_session).delete(item)


class TestTheDocumentsModule:
    async def test_it_will_not_rename_or_move_a_history_document(
        self, db_session, dept
    ):
        item = await _upload(db_session, dept)
        with pytest.raises(HTTPException) as caught:
            await documents_endpoint.update_document(
                document_id=uuid.UUID(item.id),
                doc=DocumentsModuleUpdate(name="Renamed"),
                db=db_session,
                current_user=dept.historian,
            )
        assert caught.value.status_code == 409

    async def test_it_will_not_delete_one_by_any_path(self, db_session, dept):
        item = await _upload(db_session, dept)
        with pytest.raises(HTTPException) as caught:
            await documents_endpoint.delete_document(
                document_id=uuid.UUID(item.id),
                db=db_session,
                current_user=dept.historian,
            )
        assert caught.value.status_code == 409
        with pytest.raises(ValueError, match="catalogued in History"):
            await DocumentsService(db_session).delete_document(
                item.id, dept.org_id, dept.historian
            )

    async def test_nothing_is_uploaded_into_the_history_folder_from_documents(
        self, db_session, dept, uploads
    ):
        folder = await DocumentsService(db_session).ensure_history_folder(dept.org_id)
        with pytest.raises(HTTPException) as caught:
            await documents_endpoint.upload_document(
                file=UploadFile(io.BytesIO(_letter("x")), filename="x.pdf"),
                name=None,
                description=None,
                folder_id=str(folder.id),
                tags=None,
                db=db_session,
                current_user=dept.historian,
            )
        assert caught.value.status_code == 409
        assert _stored_files(uploads) == []

    async def test_delete_folder_will_not_bulk_delete_a_history_document(
        self, db_session, dept
    ):
        """Defense in depth: delete_folder's bulk ``DELETE`` has no per-row
        check the way delete_document does. A catalogued document can only
        reach an ordinary folder today by direct manipulation (the normal
        upload/move paths all refuse it), but if one ever did, the cascade
        must still refuse it rather than silently destroying the catalogued
        row the one-at-a-time path protects."""
        item = await _upload(db_session, dept)
        folder = DocumentFolder(organization_id=dept.org_id, name="Ordinary Folder")
        db_session.add(folder)
        await db_session.flush()
        document = await db_session.get(Document, item.id)
        document.folder_id = folder.id
        await db_session.flush()

        with pytest.raises(ValueError, match="catalogued in History"):
            await DocumentsService(db_session).delete_folder(
                uuid.UUID(folder.id), dept.org_id, dept.historian
            )

        assert await db_session.get(Document, item.id) is not None
        assert await db_session.get(DocumentFolder, folder.id) is not None

    async def test_a_subfolder_of_history_is_history_too(self, db_session, dept):
        service = DocumentsService(db_session)
        root = await service.ensure_history_folder(dept.org_id)
        child = DocumentFolder(
            organization_id=dept.org_id, name="Letters", parent_id=root.id
        )
        db_session.add(child)
        await db_session.flush()
        assert await service.is_in_history_tree(child, dept.org_id) is True
        general = await service.general_folder(dept.org_id, dept.actor)
        assert await service.is_in_history_tree(general, dept.org_id) is False


class TestDocumentTypes:
    async def test_the_starting_list_is_made_once(self, db_session, dept):
        types = HistoryDocumentTypeService(db_session)
        first = await types.list_types(dept.org_id, include_retired=False)
        second = await types.list_types(dept.org_id, include_retired=False)
        assert [e.name for e, _ in first] == [
            "Letter",
            "Minutes",
            "Newspaper clipping",
            "Certificate",
            "Programme",
            "Report",
            "Other",
        ]
        assert [e.id for e, _ in second] == [e.id for e, _ in first]

    async def test_a_merge_moves_its_documents(self, db_session, dept):
        types = HistoryDocumentTypeService(db_session)
        rows = await types.list_types(dept.org_id, include_retired=False)
        letter = next(e for e, _ in rows if e.name == "Letter")
        report = next(e for e, _ in rows if e.name == "Report")
        item = await _upload(db_session, dept, document_type_id=letter.id)
        await types.merge_type(letter, report)
        reloaded = await HistoryDocumentService(db_session).get_document(
            dept.org_id, item.id
        )
        assert reloaded.document_type_id == report.id
        assert await db_session.get(HistoryDocumentType, letter.id) is None


class TestClearance:
    async def test_a_document_goes_through_the_clearance_list(self, db_session, dept):
        clearance = HistoryClearanceService(db_session)
        await clearance.replace_steps(
            dept.org_id, [{"name": "President", "position_id": dept.president_position}]
        )
        item = await _upload(db_session, dept)
        request, notify = await clearance.submit(
            item, ClearancePurpose.PUBLIC, dept.actor
        )
        assert (request.record_type, request.record_id) == ("document", item.id)
        assert notify == [str(dept.president.id)]
        with pytest.raises(ValueError, match="clearance list"):
            await HistoryDocumentService(db_session).publish(
                item, PublicationLevel.PUBLIC, dept.actor
            )
