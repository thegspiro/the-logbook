"""Minutes attachments travel with the published library copy.

Owner decision 2026-11-01: the copy of adopted minutes published to Documents
lists the files filed with them, and whoever can read that copy can open them.
Nobody else can: the files are served through the published document, under
the document's own folder rules, and only the files the copy lists — a file
filed after publishing (a signed copy) waits for the next publish.

Driven over HTTP against the real schema, because what is under test is the
boundary: which document, which folder, which organization.
"""

from io import BytesIO
from typing import Optional

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from pypdf import PdfReader
from reportlab.lib.pagesizes import letter
from reportlab.pdfgen import canvas
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import get_current_user
from app.api.v1.endpoints import documents as documents_endpoints
from app.core.database import get_db
from app.models.document import Document
from app.models.user import Organization, User
from app.services import file_storage_service as file_storage
from app.services import upload_scanning
from tests.minutes_support import (
    _approve,
    _client,
    _create,
    _pdf_bytes,
    _user,
    _World,
    build_world,
)

pytestmark = [pytest.mark.integration]

READER = ["documents.view"]


@pytest.fixture(autouse=True)
def storage(tmp_path, monkeypatch):
    monkeypatch.setattr(file_storage, "UPLOADS_ROOT", str(tmp_path))
    monkeypatch.setattr(upload_scanning, "is_malware_scan_enabled", lambda: False)
    return tmp_path


@pytest.fixture
async def world(db_session: AsyncSession) -> _World:
    return await build_world(db_session)


def _documents_client(db: AsyncSession, user: User) -> AsyncClient:
    app = FastAPI()
    app.include_router(documents_endpoints.router, prefix="/documents")
    app.dependency_overrides[get_current_user] = lambda: user
    app.dependency_overrides[get_db] = lambda: db
    return AsyncClient(
        transport=ASGITransport(app=app, raise_app_exceptions=False),
        base_url="http://test",
    )


async def _attach(
    w: _World,
    minutes_id: str,
    *,
    title: str = "Treasurer report",
    category: str = "report",
    content: Optional[bytes] = None,
) -> dict:
    async with _client(w.db, w.secretary) as c:
        resp = await c.post(
            f"/minutes/{minutes_id}/attachments",
            files={"file": ("report.pdf", content or _pdf_bytes(), "application/pdf")},
            data={"title": title, "category": category},
        )
    assert resp.status_code == 201, resp.text
    return resp.json()


async def _publish(w: _World, minutes_id: str) -> dict:
    async with _client(w.db, w.secretary) as c:
        resp = await c.post(f"/minutes/{minutes_id}/publish")
    assert resp.status_code in (200, 201), resp.text
    return resp.json()


async def _published_with_attachment(w: _World, **extra) -> tuple[dict, dict, bytes]:
    content = _pdf_bytes()
    minutes = await _create(w, **extra)
    attachment = await _attach(w, minutes["id"], content=content)
    await _approve(w, minutes["id"])
    document = await _publish(w, minutes["id"])
    return document, attachment, content


class TestThePublishedCopyListsItsFiles:
    async def test_the_library_copy_names_each_attachment(self, world: _World):
        document, _attachment, _content = await _published_with_attachment(world)

        row = await world.db.get(Document, document["id"])
        assert row is not None
        assert "Treasurer report" in (row.content_html or "")

    async def test_a_library_reader_lists_and_opens_the_file(self, world: _World):
        document, attachment, content = await _published_with_attachment(world)
        reader = await _user(world.db, world.org_id, "Reader", READER)

        async with _documents_client(world.db, reader) as c:
            listed = await c.get(f"/documents/{document['id']}/minutes-attachments")
            download = await c.get(
                f"/documents/{document['id']}/minutes-attachments/"
                f"{attachment['id']}/file"
            )

        assert listed.status_code == 200, listed.text
        assert [a["id"] for a in listed.json()] == [attachment["id"]]
        assert listed.json()[0]["title"] == "Treasurer report"
        assert download.status_code == 200, download.text
        assert download.content == content


class TestNobodyElse:
    async def test_without_documents_access_the_route_refuses(self, world: _World):
        document, attachment, _content = await _published_with_attachment(world)

        # world.member holds minutes.view only: the published copy is not theirs
        # to read, whatever the minutes screen lets them see.
        async with _documents_client(world.db, world.member) as c:
            resp = await c.get(
                f"/documents/{document['id']}/minutes-attachments/"
                f"{attachment['id']}/file"
            )
        assert resp.status_code == 403

    async def test_another_department_gets_not_found(self, world: _World):
        document, attachment, _content = await _published_with_attachment(world)
        stranger = await _user(world.db, world.other_org_id, "Stranger", READER)

        reader = await _user(world.db, world.org_id, "Reader", READER)
        async with _documents_client(world.db, reader) as c:
            own = await c.get(f"/documents/{document['id']}/minutes-attachments")
        assert own.status_code == 200

        async with _documents_client(world.db, stranger) as c:
            listed = await c.get(f"/documents/{document['id']}/minutes-attachments")
            download = await c.get(
                f"/documents/{document['id']}/minutes-attachments/"
                f"{attachment['id']}/file"
            )
        assert listed.status_code == 404
        assert download.status_code == 404

    async def test_a_file_of_other_minutes_is_not_reachable(self, world: _World):
        document, attachment, _content = await _published_with_attachment(world)
        other = await _create(world)
        stray = await _attach(world, other["id"], title="Other file")
        reader = await _user(world.db, world.org_id, "Reader", READER)

        async with _documents_client(world.db, reader) as c:
            resp = await c.get(
                f"/documents/{document['id']}/minutes-attachments/{stray['id']}/file"
            )
            own = await c.get(
                f"/documents/{document['id']}/minutes-attachments/"
                f"{attachment['id']}/file"
            )
        assert resp.status_code == 404
        assert own.status_code == 200

    async def test_executive_copies_keep_their_leadership_folder(self, world: _World):
        org = await world.db.get(Organization, world.org_id)
        assert org is not None
        org.settings = {
            **(org.settings or {}),
            "minutes": {"executive_library_publishing": True},
        }
        await world.db.flush()
        document, attachment, _content = await _published_with_attachment(
            world, meeting_type="executive"
        )
        reader = await _user(world.db, world.org_id, "Reader", READER)
        librarian = await _user(
            world.db, world.org_id, "Librarian", ["documents.view", "documents.manage"]
        )
        url = f"/documents/{document['id']}/minutes-attachments"

        async with _documents_client(world.db, reader) as c:
            listed = await c.get(url)
            download = await c.get(f"{url}/{attachment['id']}/file")
        async with _documents_client(world.db, librarian) as c:
            allowed = await c.get(f"{url}/{attachment['id']}/file")
        assert listed.status_code == 404
        assert download.status_code == 404
        # The folder's own audience still opens it: the 404s above are the
        # folder rule, not a route that answers nobody.
        assert allowed.status_code == 200, allowed.text


class TestOnlyWhatTheCopyLists:
    async def test_a_signed_copy_filed_after_publishing_waits_for_republish(
        self, world: _World
    ):
        document, _attachment, _content = await _published_with_attachment(world)
        minutes_id = document["source_id"]
        signed = await _attach(
            world, minutes_id, title="Signed copy", category="signed_copy"
        )
        reader = await _user(world.db, world.org_id, "Reader", READER)
        url = f"/documents/{document['id']}/minutes-attachments"

        async with _documents_client(world.db, reader) as c:
            before = await c.get(f"{url}/{signed['id']}/file")
            listed_before = (await c.get(url)).json()
        assert before.status_code == 404
        assert signed["id"] not in [a["id"] for a in listed_before]

        await _publish(world, minutes_id)
        async with _documents_client(world.db, reader) as c:
            after = await c.get(f"{url}/{signed['id']}/file")
            listed_after = (await c.get(url)).json()
        assert after.status_code == 200
        assert signed["id"] in [a["id"] for a in listed_after]


class TestTheMinutesPdf:
    """``GET /minutes/{id}/pdf`` reads the stored files and embeds them."""

    async def test_a_pdf_attachment_is_appended_to_the_export(self, world: _World):
        buf = BytesIO()
        page = canvas.Canvas(buf, pagesize=letter)
        page.drawString(72, 700, "Treasurer figures")
        page.showPage()
        page.save()
        minutes = await _create(world)
        await _attach(world, minutes["id"], content=buf.getvalue())

        async with _client(world.db, world.secretary) as c:
            resp = await c.get(f"/minutes/{minutes['id']}/pdf")

        assert resp.status_code == 200, resp.text
        reader = PdfReader(BytesIO(resp.content))
        assert "Treasurer figures" in (reader.pages[-1].extract_text() or "")
