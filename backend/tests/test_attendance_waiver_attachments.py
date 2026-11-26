"""Documents filed with attendance waiver requests.

Over HTTP through the real API router, as ``test_attendance_waiver_endpoints``
does, with the uploads volume pointed at a temporary directory. Pinned:

* the limits (owner decisions, 2026-11-10): PDF, JPEG, PNG or HEIC by
  detected content, never by name; 10 MB each; three per request; a file
  whose name claims one type and whose bytes are another is refused, and a
  refused upload leaves neither a request nor a file behind;
* the policy: documents refused when it is off, a submission without one
  refused when it is required; nothing filed after a decision;
* who may open one: the member and the people who may decide the request,
  404 for any other member and for another department; a neutral filename,
  an uncacheable response, and an audit entry carrying ids only;
* retention removes the files and their rows once, after the period, and
  keeps the request; anonymisation removes them at once;
* the table is registered with the storage sweep and the member's export.
"""

import hashlib
import io
import json
import os
from datetime import datetime, timedelta
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from PIL import Image
from sqlalchemy import select, text, update

from app.api.dependencies import get_current_user, get_request_enabled_modules
from app.api.v1.api import api_router
from app.core.database import get_db
from app.core.error_codes import CodedHTTPException, ErrorCode
from app.core.security_middleware import verify_csrf_token
from app.models.attendance_waiver import (
    AttendanceWaiverAttachment,
    AttendanceWaiverRequest,
    AttendanceWaiverStatus,
)
from app.models.user import User
from app.schemas.attendance_waiver import MAX_ATTACHMENT_BYTES
from app.services import attendance_waiver_attachments as waiver_attachments
from app.services import attendance_waiver_service as engine
from app.services import file_storage_service
from app.services.attendance_waiver_attachments import (
    ATTACHMENT_FILE_RULES,
    AttendanceWaiverAttachmentService,
    remove_member_attachments,
)
from app.services.data_export_service import DataExportService
from app.services.upload_relocation import collect_references
from app.utils.mime_validation import detect_mime_type
from app.utils.photo_metadata import strip_photo_metadata
from tests.waiver_request_support import (
    assign,
    load,
    make_member,
    make_org,
    make_position,
    make_requirement,
    make_session,
    set_policy,
    utc,
)

NOW = utc(2026, 11, 10, 12)
DRILL = utc(2026, 11, 20, 23)
BASE = "/api/v1/training/waivers/requests"

# Real headers, so libmagic decides the type as it would for a member's file.
PDF = b"%PDF-1.4\n" + b"1 0 obj << /Type /Catalog >> endobj\n" * 20 + b"%%EOF\n"
HEIC = b"\x00\x00\x00\x18ftypheic\x00\x00\x00\x00mif1heic" + b"\x00" * 200
# A real photo, which decodes (see tests/test_heic_to_jpeg.py for how it was
# made): HEIC above is a header only and is refused once it is converted.
HEIC_FIXTURES = Path(__file__).parent / "fixtures" / "heic"
PHOTO = (HEIC_FIXTURES / "oriented-gps.heic").read_bytes()
# JPEGs and PNGs carrying GPS and every other kind of metadata (see
# tests/test_photo_metadata.py for what each holds).
METADATA_FIXTURES = Path(__file__).parent / "fixtures" / "photo-metadata"


def _image(fmt: str) -> bytes:
    out = io.BytesIO()
    Image.new("RGB", (8, 8), (200, 30, 30)).save(out, format=fmt)
    return out.getvalue()


PNG = _image("PNG")
JPEG = _image("JPEG")
GIF = _image("GIF")


def _pdf(name: str = "doctors-note-for-my-back.pdf"):
    return ("files", (name, PDF, "application/pdf"))


# ---------------------------------------------------------------------------
# The rules, without a database
# ---------------------------------------------------------------------------


@pytest.mark.unit
class TestTheRules:
    @pytest.mark.parametrize(
        ("content", "mime"),
        [
            (PDF, "application/pdf"),
            (JPEG, "image/jpeg"),
            (PNG, "image/png"),
            (HEIC, "image/heic"),
        ],
    )
    def test_the_four_owner_approved_types_are_detected_and_allowed(
        self, content, mime
    ):
        assert detect_mime_type(content) == mime
        assert mime in ATTACHMENT_FILE_RULES.allowed_types

    def test_nothing_else_is_allowed(self):
        assert detect_mime_type(GIF) == "image/gif"
        assert set(ATTACHMENT_FILE_RULES.allowed_types) == {
            "application/pdf",
            "image/jpeg",
            "image/png",
            "image/heic",
            "image/heif",
        }
        assert ATTACHMENT_FILE_RULES.max_bytes == 10 * 1024 * 1024

    def test_heic_is_accepted_only_by_this_area(self):
        from app.services.minutes_record_service import ATTACHMENT_FILE_RULES as m

        assert "image/heic" not in m.allowed_types

    def test_the_download_name_is_neutral(self):
        row = AttendanceWaiverAttachment(
            ordinal=2, file_path="/app/uploads/o/attendance-waivers/r/ab12.HEIC"
        )
        assert row.download_name == "waiver-attachment-2.heic"


# ---------------------------------------------------------------------------
# A department, over HTTP
# ---------------------------------------------------------------------------


@pytest.fixture(autouse=True)
def _clock(monkeypatch):
    monkeypatch.setattr(engine, "_now", lambda: NOW)


@pytest.fixture
def uploads(tmp_path, monkeypatch):
    monkeypatch.setattr(file_storage_service, "UPLOADS_ROOT", str(tmp_path))
    return tmp_path


def _files_on_disk(root) -> list[str]:
    return sorted(
        os.path.join(d, f)
        for d, _dirs, names in os.walk(root)
        for f in names
        if "attendance-waivers" in d
    )


@pytest.fixture
async def dept(db_session, uploads):
    org_id = await make_org(db_session)
    officer_pos = await make_position(db_session, org_id, "Training Officer")
    ids = {
        name: await make_member(db_session, org_id, name.title())
        for name in ("member", "other", "officer")
    }
    await assign(db_session, ids["officer"], officer_pos)
    await set_policy(
        db_session,
        org_id,
        approver_position_ids=[officer_pos],
        attachment="optional",
    )
    requirement = await make_requirement(db_session, org_id)
    drill = await make_session(db_session, org_id, DRILL, link=[requirement])
    foreign_org = await make_org(db_session)
    foreign = await make_member(db_session, foreign_org, "Foreign")
    users = {name: await load(db_session, uid) for name, uid in ids.items()}
    return SimpleNamespace(
        org=org_id,
        officer_pos=officer_pos,
        drill=drill,
        foreign=await load(db_session, foreign),
        uploads=uploads,
        **users,
    )


_CURRENT: dict = {}
_APP = FastAPI()
_APP.include_router(api_router, prefix="/api/v1")
_APP.dependency_overrides[get_current_user] = lambda: _CURRENT["user"]
_APP.dependency_overrides[get_db] = lambda: _CURRENT["db"]
_APP.dependency_overrides[verify_csrf_token] = lambda: None
_APP.dependency_overrides[get_request_enabled_modules] = lambda: None


@pytest.fixture
def as_user(db_session):
    _CURRENT["db"] = db_session

    def client(user) -> AsyncClient:
        _CURRENT["user"] = user
        return AsyncClient(transport=ASGITransport(app=_APP), base_url="http://test")

    yield client
    _CURRENT.clear()


async def _submit_with(as_user, member, event_id, files, **data):
    async with as_user(member) as client:
        return await client.post(
            f"{BASE}/with-attachments",
            data={"event_id": event_id, **data},
            files=files,
        )


async def _request_count(db_session, org_id) -> int:
    return len(
        (
            await db_session.execute(
                select(AttendanceWaiverRequest.id).where(
                    AttendanceWaiverRequest.organization_id == org_id
                )
            )
        ).all()
    )


@pytest.mark.integration
class TestSubmitting:
    async def test_documents_are_filed_with_the_request(self, as_user, dept):
        resp = await _submit_with(
            as_user,
            dept.member,
            dept.drill,
            [_pdf(), ("files", ("IMG_0001.HEIC", PHOTO, "image/heic"))],
            reason="Back injury",
        )
        assert resp.status_code == 201, resp.text
        body = resp.json()
        assert [
            (a["ordinal"], a["filename"], a["mime_type"]) for a in body["attachments"]
        ] == [
            (1, "waiver-attachment-1.pdf", "application/pdf"),
            (2, "waiver-attachment-2.jpg", "image/jpeg"),
        ]
        assert body["can_attach"] is True
        on_disk = _files_on_disk(dept.uploads)
        assert len(on_disk) == 2
        # Under the request, named by the server: the uploader's filename
        # is nowhere, not on disk and not in the row.
        assert all(f"{dept.org}/attendance-waivers/{body['id']}/" in p for p in on_disk)
        assert not any("doctors-note" in p for p in on_disk)
        rows = (
            (
                await _CURRENT["db"].execute(
                    select(AttendanceWaiverAttachment).where(
                        AttendanceWaiverAttachment.request_id == body["id"]
                    )
                )
            )
            .scalars()
            .all()
        )
        assert len(rows) == 2
        assert all(len(r.sha256) == 64 for r in rows)
        assert {r.uploaded_by for r in rows} == {str(dept.member.id)}

    async def test_off_refuses_documents_and_stores_nothing(
        self, as_user, dept, db_session
    ):
        await set_policy(db_session, dept.org, approver_position_ids=[dept.officer_pos])
        resp = await _submit_with(as_user, dept.member, dept.drill, [_pdf()])
        assert resp.status_code == 400
        assert "does not take documents" in resp.json()["detail"]
        assert _files_on_disk(dept.uploads) == []
        assert await _request_count(db_session, dept.org) == 0

    async def test_required_refuses_a_submission_without_one(
        self, as_user, dept, db_session
    ):
        await set_policy(
            db_session,
            dept.org,
            approver_position_ids=[dept.officer_pos],
            attachment="required",
        )
        async with as_user(dept.member) as client:
            bare = await client.post(BASE, json={"event_id": dept.drill})
        assert bare.status_code == 400
        assert bare.json()["detail"] == "Attach a document to this request."
        assert await _request_count(db_session, dept.org) == 0

        filed = await _submit_with(as_user, dept.member, dept.drill, [_pdf()])
        assert filed.status_code == 201, filed.text
        assert len(filed.json()["attachments"]) == 1

    async def test_a_refused_session_leaves_no_file(self, as_user, dept, db_session):
        resp = await _submit_with(as_user, dept.member, "no-such-event", [_pdf()])
        assert resp.status_code == 404
        assert _files_on_disk(dept.uploads) == []

    async def test_more_than_three_is_refused(self, as_user, dept, db_session):
        resp = await _submit_with(
            as_user, dept.member, dept.drill, [_pdf(f"{i}.pdf") for i in range(4)]
        )
        assert resp.status_code == 400
        assert "At most 3" in resp.json()["detail"]
        assert _files_on_disk(dept.uploads) == []
        assert await _request_count(db_session, dept.org) == 0

    async def test_over_ten_megabytes_is_refused(self, as_user, dept, db_session):
        big = PDF + b"0" * (MAX_ATTACHMENT_BYTES - len(PDF) + 1)
        resp = await _submit_with(
            as_user,
            dept.member,
            dept.drill,
            [("files", ("big.pdf", big, "application/pdf"))],
        )
        assert resp.status_code == 400
        assert "Maximum size is 10MB" in resp.json()["detail"]
        assert await _request_count(db_session, dept.org) == 0

    async def test_exactly_ten_megabytes_is_accepted(self, as_user, dept):
        full = PDF + b"0" * (MAX_ATTACHMENT_BYTES - len(PDF))
        resp = await _submit_with(
            as_user,
            dept.member,
            dept.drill,
            [("files", ("full.pdf", full, "application/pdf"))],
        )
        assert resp.status_code == 201, resp.text
        assert resp.json()["attachments"][0]["file_size"] == MAX_ATTACHMENT_BYTES

    @pytest.mark.parametrize(
        ("name", "content", "claimed"),
        [
            # A name and a browser type saying HEIC or PDF, and bytes that are
            # neither: the detected content decides.
            ("note.heic", b"just some text, not an image" * 10, "image/heic"),
            ("note.pdf", GIF, "application/pdf"),
            ("note.png", GIF, "image/png"),
        ],
    )
    async def test_the_wrong_magic_bytes_are_refused(
        self, as_user, dept, db_session, name, content, claimed
    ):
        resp = await _submit_with(
            as_user,
            dept.member,
            dept.drill,
            [_pdf("good.pdf"), ("files", (name, content, claimed))],
        )
        assert resp.status_code == 400
        assert "File type not allowed" in resp.json()["detail"]
        # The good file stored first is removed with the refusal.
        assert _files_on_disk(dept.uploads) == []
        assert await _request_count(db_session, dept.org) == 0

    @pytest.mark.parametrize(
        ("name", "content", "mime"),
        [("a.jpg", JPEG, "image/jpeg"), ("b.png", PNG, "image/png")],
    )
    async def test_jpeg_and_png_are_accepted(self, as_user, dept, name, content, mime):
        resp = await _submit_with(
            as_user, dept.member, dept.drill, [("files", (name, content, mime))]
        )
        assert resp.status_code == 201, resp.text
        assert resp.json()["attachments"][0]["mime_type"] == mime


async def _filed(as_user, dept, count=1) -> str:
    resp = await _submit_with(
        as_user, dept.member, dept.drill, [_pdf(f"{i}.pdf") for i in range(count)]
    )
    assert resp.status_code == 201, resp.text
    return resp.json()["id"]


@pytest.mark.integration
class TestAddingLater:
    async def test_the_member_adds_while_pending_up_to_three(self, as_user, dept):
        request_id = await _filed(as_user, dept, count=2)
        async with as_user(dept.member) as client:
            added = await client.post(
                f"{BASE}/{request_id}/attachments",
                files=[("files", ("x.png", PNG, "image/png"))],
            )
            again = await client.post(
                f"{BASE}/{request_id}/attachments", files=[_pdf()]
            )
        assert added.status_code == 200, added.text
        assert [a["ordinal"] for a in added.json()["attachments"]] == [1, 2, 3]
        assert added.json()["can_attach"] is False
        assert again.status_code == 400
        assert "At most 3" in again.json()["detail"]
        assert len(_files_on_disk(dept.uploads)) == 3

    async def test_only_the_member_may_add(self, as_user, dept):
        request_id = await _filed(as_user, dept)
        async with as_user(dept.officer) as client:
            decider = await client.post(
                f"{BASE}/{request_id}/attachments", files=[_pdf()]
            )
        async with as_user(dept.other) as client:
            other = await client.post(
                f"{BASE}/{request_id}/attachments", files=[_pdf()]
            )
        async with as_user(dept.foreign) as client:
            foreign = await client.post(
                f"{BASE}/{request_id}/attachments", files=[_pdf()]
            )
        assert (decider.status_code, other.status_code, foreign.status_code) == (
            403,
            404,
            404,
        )
        assert len(_files_on_disk(dept.uploads)) == 1

    async def test_nothing_is_added_after_a_decision(self, as_user, dept):
        request_id = await _filed(as_user, dept)
        async with as_user(dept.officer) as client:
            decided = await client.post(f"{BASE}/{request_id}/approve", json={})
        assert decided.status_code == 200, decided.text
        assert decided.json()["can_attach"] is False
        async with as_user(dept.member) as client:
            late = await client.post(f"{BASE}/{request_id}/attachments", files=[_pdf()])
        assert late.status_code == 400
        assert "while the request is pending" in late.json()["detail"]
        assert len(_files_on_disk(dept.uploads)) == 1

    async def test_off_refuses_a_later_document(self, as_user, dept, db_session):
        request_id = await _filed(as_user, dept)
        await set_policy(db_session, dept.org, approver_position_ids=[dept.officer_pos])
        async with as_user(dept.member) as client:
            resp = await client.post(f"{BASE}/{request_id}/attachments", files=[_pdf()])
        assert resp.status_code == 400
        assert len(_files_on_disk(dept.uploads)) == 1


@pytest.mark.integration
class TestHeicIsStoredAsJpeg:
    """Owner decision 2026-11-26: a phone's HEIC photo is kept as a JPEG."""

    async def test_a_photo_is_filed_as_a_jpeg_with_no_metadata(
        self, as_user, dept, monkeypatch
    ):
        scanned: list = []

        async def _record_scan(db, content, *, upload_kind, detected_mime, user):
            scanned.append((detected_mime, hashlib.sha256(content).hexdigest()))

        monkeypatch.setattr(file_storage_service, "reject_if_malicious", _record_scan)
        resp = await _submit_with(
            as_user,
            dept.member,
            dept.drill,
            [("files", ("IMG_0001.HEIC", PHOTO, "image/heic"))],
        )
        assert resp.status_code == 201, resp.text
        assert [
            (a["filename"], a["mime_type"]) for a in resp.json()["attachments"]
        ] == [("waiver-attachment-1.jpg", "image/jpeg")]
        (path,) = _files_on_disk(dept.uploads)
        assert path.endswith(".jpg")
        # Read back through the store: the file on disk is encrypted at rest.
        stored = await file_storage_service.read_bytes(path)
        assert detect_mime_type(stored) == "image/jpeg"
        image = Image.open(io.BytesIO(stored))
        assert image.size == (16, 32)
        assert len(image.getexif()) == 0
        # The member's original is scanned before it is decoded; then the
        # scan, the row and the disk all describe the converted file.
        digest = hashlib.sha256(stored).hexdigest()
        assert scanned == [
            ("image/heic", hashlib.sha256(PHOTO).hexdigest()),
            ("image/jpeg", digest),
        ]
        row = (
            await _CURRENT["db"].execute(
                select(AttendanceWaiverAttachment).where(
                    AttendanceWaiverAttachment.request_id == resp.json()["id"]
                )
            )
        ).scalar_one()
        assert (row.mime_type, row.file_size, row.sha256) == (
            "image/jpeg",
            len(stored),
            digest,
        )

    async def test_a_photo_added_later_is_converted_too(self, as_user, dept):
        request_id = await _filed(as_user, dept)
        async with as_user(dept.member) as client:
            added = await client.post(
                f"{BASE}/{request_id}/attachments",
                files=[("files", ("IMG_0002.HEIC", PHOTO, "image/heic"))],
            )
        assert added.status_code == 200, added.text
        assert [
            (a["ordinal"], a["filename"], a["mime_type"])
            for a in added.json()["attachments"]
        ][-1] == (2, "waiver-attachment-2.jpg", "image/jpeg")
        assert sum(p.endswith(".jpg") for p in _files_on_disk(dept.uploads)) == 1

    async def test_an_unreadable_photo_is_refused_and_nothing_is_kept(
        self, as_user, dept, db_session
    ):
        resp = await _submit_with(
            as_user,
            dept.member,
            dept.drill,
            [_pdf(), ("files", ("IMG_0003.HEIC", PHOTO[:400], "image/heic"))],
        )
        assert resp.status_code == 400, resp.text
        assert "couldn't read this photo" in resp.json()["detail"]
        assert _files_on_disk(dept.uploads) == []
        assert await _request_count(db_session, dept.org) == 0

    async def test_with_no_scanner_nothing_is_decoded(
        self, as_user, dept, db_session, monkeypatch
    ):
        decoded: list = []

        async def _unavailable(db, content, *, upload_kind, detected_mime, user):
            raise CodedHTTPException(
                status_code=503,
                detail="Malware scanning is unavailable.",
                error_code=ErrorCode.UPLD_SCAN_UNAVAILABLE,
            )

        async def _spy(content, max_bytes=None):
            decoded.append(len(content))
            return b""

        monkeypatch.setattr(file_storage_service, "reject_if_malicious", _unavailable)
        monkeypatch.setattr(waiver_attachments, "heic_to_jpeg", _spy)
        resp = await _submit_with(
            as_user,
            dept.member,
            dept.drill,
            [("files", ("IMG_0004.HEIC", PHOTO, "image/heic"))],
        )
        assert resp.status_code == 503, resp.text
        assert decoded == []
        assert _files_on_disk(dept.uploads) == []
        assert await _request_count(db_session, dept.org) == 0

    @pytest.mark.parametrize("fixture", ["corrupt-segfault", "corrupt-infe-v4"])
    async def test_a_photo_that_breaks_the_decoder_is_a_400(
        self, as_user, dept, db_session, fixture
    ):
        broken = (HEIC_FIXTURES / f"{fixture}.heic").read_bytes()
        resp = await _submit_with(
            as_user,
            dept.member,
            dept.drill,
            [_pdf(), ("files", ("IMG_0005.HEIC", broken, "image/heic"))],
        )
        assert resp.status_code == 400, resp.text
        assert "couldn't read this photo" in resp.json()["detail"]
        # The PDF stored first is removed with it, and nothing is filed.
        assert _files_on_disk(dept.uploads) == []
        assert await _request_count(db_session, dept.org) == 0
        # And the server is still here to take the next request.
        retry = await _submit_with(as_user, dept.member, dept.drill, [_pdf()])
        assert retry.status_code == 201, retry.text

    async def test_a_photo_with_broken_exif_is_filed_without_it(self, as_user, dept):
        broken = (HEIC_FIXTURES / "corrupt-exif-header.heic").read_bytes()
        resp = await _submit_with(
            as_user,
            dept.member,
            dept.drill,
            [("files", ("IMG_0006.HEIC", broken, "image/heic"))],
        )
        assert resp.status_code == 201, resp.text
        assert [a["mime_type"] for a in resp.json()["attachments"]] == ["image/jpeg"]


@pytest.mark.integration
class TestJpegAndPngAreStoredWithoutMetadata:
    """Owner decision 2026-11-26: a JPEG or PNG is stored without its
    location or other metadata, and without being re-compressed."""

    @pytest.mark.parametrize(
        ("name", "mime"),
        [
            ("everything.jpg", "image/jpeg"),
            ("progressive.jpg", "image/jpeg"),
            ("cmyk-adobe.jpg", "image/jpeg"),
            ("everything.png", "image/png"),
        ],
    )
    async def test_the_photo_is_filed_without_its_metadata(
        self, as_user, dept, monkeypatch, name, mime
    ):
        original = (METADATA_FIXTURES / name).read_bytes()
        scanned: list = []

        async def _record_scan(db, content, *, upload_kind, detected_mime, user):
            scanned.append((detected_mime, hashlib.sha256(content).hexdigest()))

        monkeypatch.setattr(file_storage_service, "reject_if_malicious", _record_scan)
        resp = await _submit_with(
            as_user, dept.member, dept.drill, [("files", (name, original, mime))]
        )
        assert resp.status_code == 201, resp.text
        assert [a["mime_type"] for a in resp.json()["attachments"]] == [mime]
        (path,) = _files_on_disk(dept.uploads)
        stored = await file_storage_service.read_bytes(path)
        assert stored == strip_photo_metadata(original, mime)
        assert b"GPS" in original
        assert b"GPS" not in stored
        before = Image.open(io.BytesIO(original))
        after = Image.open(io.BytesIO(stored))
        assert after.tobytes() == before.tobytes()
        assert dict(after.getexif()) == {0x0112: 6}
        # The member's original is scanned first, then the file kept; the
        # row describes the file kept.
        digest = hashlib.sha256(stored).hexdigest()
        assert scanned == [(mime, hashlib.sha256(original).hexdigest()), (mime, digest)]
        row = (
            await _CURRENT["db"].execute(
                select(AttendanceWaiverAttachment).where(
                    AttendanceWaiverAttachment.request_id == resp.json()["id"]
                )
            )
        ).scalar_one()
        assert (row.mime_type, row.file_size, row.sha256) == (mime, len(stored), digest)

    async def test_a_photo_added_later_is_stripped_too(self, as_user, dept):
        original = (METADATA_FIXTURES / "everything.jpg").read_bytes()
        request_id = await _filed(as_user, dept)
        async with as_user(dept.member) as client:
            added = await client.post(
                f"{BASE}/{request_id}/attachments",
                files=[("files", ("IMG_0007.jpg", original, "image/jpeg"))],
            )
        assert added.status_code == 200, added.text
        (path,) = [p for p in _files_on_disk(dept.uploads) if p.endswith(".jpg")]
        stored = await file_storage_service.read_bytes(path)
        assert stored == strip_photo_metadata(original, "image/jpeg")

    @pytest.mark.parametrize(
        ("name", "content", "mime"),
        [
            # libmagic calls both of these a JPEG and a PNG; neither can be
            # walked to its end.
            ("IMG_0008.jpg", JPEG[:-2], "image/jpeg"),
            ("IMG_0009.png", PNG[:30] + b"\x00" + PNG[31:], "image/png"),
        ],
        ids=["jpeg-without-eoi", "png-with-a-bad-crc"],
    )
    async def test_an_unreadable_photo_is_refused_and_nothing_is_kept(
        self, as_user, dept, db_session, name, content, mime
    ):
        assert detect_mime_type(content) == mime
        resp = await _submit_with(
            as_user,
            dept.member,
            dept.drill,
            [_pdf(), ("files", (name, content, mime))],
        )
        assert resp.status_code == 400, resp.text
        assert "couldn't read this photo" in resp.json()["detail"]
        assert _files_on_disk(dept.uploads) == []
        assert await _request_count(db_session, dept.org) == 0

    async def test_with_no_scanner_nothing_is_stripped_or_kept(
        self, as_user, dept, db_session, monkeypatch
    ):
        stripped: list = []

        async def _unavailable(db, content, *, upload_kind, detected_mime, user):
            raise CodedHTTPException(
                status_code=503,
                detail="Malware scanning is unavailable.",
                error_code=ErrorCode.UPLD_SCAN_UNAVAILABLE,
            )

        def _spy(content, mime_type):
            stripped.append(len(content))
            return content

        monkeypatch.setattr(file_storage_service, "reject_if_malicious", _unavailable)
        monkeypatch.setattr(waiver_attachments, "strip_photo_metadata", _spy)
        original = (METADATA_FIXTURES / "everything.png").read_bytes()
        resp = await _submit_with(
            as_user,
            dept.member,
            dept.drill,
            [("files", ("IMG_0010.png", original, "image/png"))],
        )
        assert resp.status_code == 503, resp.text
        assert stripped == []
        assert _files_on_disk(dept.uploads) == []
        assert await _request_count(db_session, dept.org) == 0


async def _download_audits(db_session, user_id):
    rows = await db_session.execute(
        text(
            "SELECT event_data FROM audit_logs WHERE user_id = :u "
            "AND event_type = 'attendance_waiver_attachment_downloaded'"
        ),
        {"u": str(user_id)},
    )
    return [r[0] for r in rows.fetchall()]


@pytest.mark.integration
class TestDownloading:
    async def _first(self, as_user, dept):
        request_id = await _filed(as_user, dept)
        async with as_user(dept.member) as client:
            body = (await client.get(f"{BASE}/{request_id}")).json()
        return request_id, body["attachments"][0]["id"]

    async def test_the_member_and_the_decider_may_open_it(
        self, as_user, dept, db_session
    ):
        request_id, attachment_id = await self._first(as_user, dept)
        url = f"{BASE}/{request_id}/attachments/{attachment_id}"
        for user in (dept.member, dept.officer):
            async with as_user(user) as client:
                resp = await client.get(url)
            assert resp.status_code == 200, resp.text
            assert resp.content == PDF
            assert resp.headers["content-type"] == "application/pdf"
            disposition = resp.headers["content-disposition"]
            assert 'filename="waiver-attachment-1.pdf"' in disposition
            assert "doctors-note" not in disposition
            assert "no-store" in resp.headers["cache-control"]

    async def test_anyone_else_gets_a_404(self, as_user, dept):
        request_id, attachment_id = await self._first(as_user, dept)
        url = f"{BASE}/{request_id}/attachments/{attachment_id}"
        for user in (dept.other, dept.foreign):
            async with as_user(user) as client:
                assert (await client.get(url)).status_code == 404
        async with as_user(dept.member) as client:
            assert (
                await client.get(f"{BASE}/{request_id}/attachments/nope")
            ).status_code == 404

    async def test_a_former_decider_may_see_but_not_open(
        self, as_user, dept, db_session
    ):
        request_id, attachment_id = await self._first(as_user, dept)
        async with as_user(dept.officer) as client:
            await client.post(f"{BASE}/{request_id}/deny", json={})
        await db_session.execute(
            text("DELETE FROM user_positions WHERE user_id = :u"),
            {"u": str(dept.officer.id)},
        )
        officer = await load(db_session, str(dept.officer.id))
        async with as_user(officer) as client:
            assert (await client.get(f"{BASE}/{request_id}")).status_code == 200
            resp = await client.get(f"{BASE}/{request_id}/attachments/{attachment_id}")
        assert resp.status_code == 403

    async def test_the_audit_records_ids_only(self, as_user, dept, db_session):
        request_id, attachment_id = await self._first(as_user, dept)
        async with as_user(dept.officer) as client:
            await client.get(f"{BASE}/{request_id}/attachments/{attachment_id}")
        async with as_user(dept.other) as client:
            await client.get(f"{BASE}/{request_id}/attachments/{attachment_id}")
        audits = await _download_audits(db_session, dept.officer.id)
        assert len(audits) == 1
        data = audits[0] if isinstance(audits[0], dict) else json.loads(audits[0])
        assert data == {
            "request_id": request_id,
            "attachment_id": attachment_id,
            "member_id": str(dept.member.id),
        }
        assert await _download_audits(db_session, dept.other.id) == []


# ---------------------------------------------------------------------------
# Retention, anonymisation and the registries
# ---------------------------------------------------------------------------


async def _close(db_session, request_id, *, status, days_ago):
    await db_session.execute(
        update(AttendanceWaiverRequest)
        .where(AttendanceWaiverRequest.id == request_id)
        .values(
            status=status,
            live_key=None,
            decided_at=(
                (NOW - timedelta(days=days_ago)).replace(tzinfo=None)
                if status
                in (AttendanceWaiverStatus.APPROVED, AttendanceWaiverStatus.DENIED)
                else None
            ),
            updated_at=(NOW - timedelta(days=days_ago)).replace(tzinfo=None),
        )
    )
    await db_session.flush()


async def _attachment_count(db_session, request_id) -> int:
    return len(
        (
            await db_session.execute(
                select(AttendanceWaiverAttachment.id).where(
                    AttendanceWaiverAttachment.request_id == request_id
                )
            )
        ).all()
    )


async def _second_session_request(as_user, dept, db_session) -> str:
    """Another request by the same member, on a second session."""
    requirement = await make_requirement(db_session, dept.org)
    later = await make_session(
        db_session, dept.org, DRILL + timedelta(days=7), link=[requirement]
    )
    resp = await _submit_with(as_user, dept.member, later, [_pdf()])
    assert resp.status_code == 201, resp.text
    return resp.json()["id"]


@pytest.mark.integration
class TestRetention:
    async def test_files_go_once_after_the_period_and_the_request_stays(
        self, as_user, dept, db_session
    ):
        expired = await _filed(as_user, dept, count=2)
        await _close(
            db_session, expired, status=AttendanceWaiverStatus.APPROVED, days_ago=366
        )
        recent = await _second_session_request(as_user, dept, db_session)
        await _close(
            db_session, recent, status=AttendanceWaiverStatus.DENIED, days_ago=10
        )
        assert len(_files_on_disk(dept.uploads)) == 3

        service = AttendanceWaiverAttachmentService(db_session)
        first = await service.sweep(now=NOW)
        assert first["files_deleted"] == 2
        assert first["requests_cleared"] == 1
        assert first["errors"] == []
        assert await _attachment_count(db_session, expired) == 0
        assert await _attachment_count(db_session, recent) == 1
        remaining = _files_on_disk(dept.uploads)
        assert len(remaining) == 1
        assert recent in remaining[0]
        # The decision record is kept.
        kept = (
            await db_session.execute(
                select(AttendanceWaiverRequest).where(
                    AttendanceWaiverRequest.id == expired
                )
            )
        ).scalar_one()
        assert kept.status == AttendanceWaiverStatus.APPROVED

        second = await service.sweep(now=NOW)
        assert second["files_deleted"] == 0
        audits = (
            await db_session.execute(
                text(
                    "SELECT event_data FROM audit_logs WHERE organization_id = :o "
                    "AND event_type = 'attendance_waiver_attachment_retention'"
                ),
                {"o": dept.org},
            )
        ).fetchall()
        assert len(audits) == 1

    # Owner decision 2026-11-23: the request says its documents were removed
    # under retention, and when, to anyone who can see it.
    async def test_the_request_records_what_retention_removed(
        self, as_user, dept, db_session
    ):
        expired = await _filed(as_user, dept, count=2)
        await _close(
            db_session, expired, status=AttendanceWaiverStatus.APPROVED, days_ago=366
        )
        before = (
            await db_session.execute(
                select(AttendanceWaiverRequest.updated_at).where(
                    AttendanceWaiverRequest.id == expired
                )
            )
        ).scalar_one()

        service = AttendanceWaiverAttachmentService(db_session)
        await service.sweep(now=NOW)
        await service.sweep(now=NOW + timedelta(days=1))

        row = (
            await db_session.execute(
                select(AttendanceWaiverRequest)
                .where(AttendanceWaiverRequest.id == expired)
                .execution_options(populate_existing=True)
            )
        ).scalar_one()
        assert row.attachments_removed_count == 2
        assert engine._utc(row.attachments_removed_at) == NOW
        # The retention clock reads updated_at; recording the removal must
        # not restart it.
        assert engine._utc(row.updated_at) == engine._utc(before)
        for viewer in (dept.member, dept.officer):
            async with as_user(viewer) as client:
                body = (await client.get(f"{BASE}/{expired}")).json()
            assert body["attachments"] == []
            assert body["attachments_removed_count"] == 2
            removed_at = datetime.fromisoformat(body["attachments_removed_at"])
            assert engine._utc(removed_at) == NOW

    async def test_a_request_retention_never_touched_says_nothing(self, as_user, dept):
        request_id = await _filed(as_user, dept)
        async with as_user(dept.member) as client:
            body = (await client.get(f"{BASE}/{request_id}")).json()
        assert body["attachments_removed_count"] is None
        assert body["attachments_removed_at"] is None

    async def test_a_department_period_is_honoured(self, as_user, dept, db_session):
        request_id = await _filed(as_user, dept)
        await _close(
            db_session, request_id, status=AttendanceWaiverStatus.DENIED, days_ago=40
        )
        service = AttendanceWaiverAttachmentService(db_session)
        assert (await service.sweep(now=NOW))["files_deleted"] == 0
        await set_policy(
            db_session,
            dept.org,
            approver_position_ids=[dept.officer_pos],
            attachment="optional",
            attachment_retention_days=30,
        )
        assert (await service.sweep(now=NOW))["files_deleted"] == 1

    async def test_a_withdrawn_request_is_timed_from_its_withdrawal(
        self, as_user, dept, db_session
    ):
        request_id = await _filed(as_user, dept)
        await _close(
            db_session,
            request_id,
            status=AttendanceWaiverStatus.WITHDRAWN,
            days_ago=400,
        )
        result = await AttendanceWaiverAttachmentService(db_session).sweep(now=NOW)
        assert result["files_deleted"] == 1

    async def test_a_pending_request_is_never_swept(self, as_user, dept, db_session):
        request_id = await _filed(as_user, dept)
        far_future = NOW + timedelta(days=5000)
        result = await AttendanceWaiverAttachmentService(db_session).sweep(
            now=far_future
        )
        assert result["files_deleted"] == 0
        assert await _attachment_count(db_session, request_id) == 1

    async def test_a_file_already_gone_still_clears_its_row(
        self, as_user, dept, db_session
    ):
        request_id = await _filed(as_user, dept)
        await _close(
            db_session, request_id, status=AttendanceWaiverStatus.APPROVED, days_ago=400
        )
        for path in _files_on_disk(dept.uploads):
            os.remove(path)
        result = await AttendanceWaiverAttachmentService(db_session).sweep(now=NOW)
        assert result["files_deleted"] == 1
        assert await _attachment_count(db_session, request_id) == 0


@pytest.mark.integration
class TestMemberData:
    async def test_anonymisation_removes_the_files_and_keeps_the_request(
        self, as_user, dept, db_session
    ):
        from app.services.member_anonymization_service import (
            MemberAnonymizationService,
        )

        request_id = await _filed(as_user, dept, count=2)
        await db_session.execute(
            update(User).where(User.id == str(dept.member.id)).values(status="archived")
        )
        member = await load(db_session, str(dept.member.id))
        result = await MemberAnonymizationService(db_session).anonymize_member(member)
        assert result["attendance_waiver_attachments_deleted"] == 2
        assert _files_on_disk(dept.uploads) == []
        assert await _attachment_count(db_session, request_id) == 0
        assert (
            await db_session.execute(
                select(AttendanceWaiverRequest.id).where(
                    AttendanceWaiverRequest.id == request_id
                )
            )
        ).scalar_one() == request_id

    async def test_removal_touches_only_that_member(self, as_user, dept, db_session):
        await _filed(as_user, dept)
        assert await remove_member_attachments(db_session, dept.other) == 0
        assert len(_files_on_disk(dept.uploads)) == 1

    async def test_the_storage_sweep_lists_them(self, as_user, dept, db_session):
        request_id = await _filed(as_user, dept)
        refs = [
            r
            for r in await collect_references(db_session, dept.org)
            if r.table == "attendance_waiver_attachments"
        ]
        assert len(refs) == 1
        assert refs[0].area is file_storage_service.StorageArea.ATTENDANCE_WAIVERS
        assert refs[0].record_id == request_id

    async def test_the_export_lists_them_without_the_stored_path(
        self, as_user, dept, db_session
    ):
        request_id = await _filed(as_user, dept)
        member = await load(db_session, str(dept.member.id))
        export = await DataExportService(db_session).export_user_data(member)
        rows = export["attendance_waiver_attachments"]
        assert [(r["request_id"], r["ordinal"]) for r in rows] == [(request_id, 1)]
        assert "file_path" not in rows[0]


# ---------------------------------------------------------------------------
# Removing a document (owner decision 2026-11-23)
# ---------------------------------------------------------------------------


async def _remove(as_user, who, request_id, attachment_id):
    async with as_user(who) as client:
        return await client.delete(f"{BASE}/{request_id}/attachments/{attachment_id}")


async def _attachment_ids(as_user, dept, request_id) -> list[str]:
    async with as_user(dept.member) as client:
        resp = await client.get(f"{BASE}/{request_id}")
    return [a["id"] for a in resp.json()["attachments"]]


@pytest.mark.integration
class TestRemoving:
    async def test_the_member_removes_one_while_pending(self, as_user, dept):
        request_id = await _filed(as_user, dept, count=2)
        first, second = await _attachment_ids(as_user, dept, request_id)

        resp = await _remove(as_user, dept.member, request_id, first)

        assert resp.status_code == 200, resp.text
        assert [a["id"] for a in resp.json()["attachments"]] == [second]
        assert resp.json()["can_attach"] is True
        assert resp.json()["can_remove_attachment"] is True
        assert len(_files_on_disk(dept.uploads)) == 1

    async def test_removing_it_again_is_a_no_op(self, as_user, dept):
        request_id = await _filed(as_user, dept, count=2)
        first, second = await _attachment_ids(as_user, dept, request_id)
        await _remove(as_user, dept.member, request_id, first)

        again = await _remove(as_user, dept.member, request_id, first)

        assert again.status_code == 200, again.text
        assert [a["id"] for a in again.json()["attachments"]] == [second]
        assert len(_files_on_disk(dept.uploads)) == 1

    async def test_only_the_member_may_remove(self, as_user, dept):
        request_id = await _filed(as_user, dept)
        (only,) = await _attachment_ids(as_user, dept, request_id)
        decider = await _remove(as_user, dept.officer, request_id, only)
        other = await _remove(as_user, dept.other, request_id, only)
        foreign = await _remove(as_user, dept.foreign, request_id, only)
        assert (decider.status_code, other.status_code, foreign.status_code) == (
            403,
            404,
            404,
        )
        assert len(_files_on_disk(dept.uploads)) == 1

    async def test_nothing_is_removed_after_a_decision(self, as_user, dept):
        request_id = await _filed(as_user, dept)
        (only,) = await _attachment_ids(as_user, dept, request_id)
        async with as_user(dept.officer) as client:
            decided = await client.post(f"{BASE}/{request_id}/approve", json={})
        assert decided.status_code == 200, decided.text

        late = await _remove(as_user, dept.member, request_id, only)

        assert late.status_code == 400
        assert "while the request is pending" in late.json()["detail"]
        assert decided.json()["can_remove_attachment"] is False
        assert len(_files_on_disk(dept.uploads)) == 1

    async def test_a_required_document_keeps_its_last_one(
        self, as_user, dept, db_session
    ):
        request_id = await _filed(as_user, dept, count=2)
        first, second = await _attachment_ids(as_user, dept, request_id)
        await set_policy(
            db_session,
            dept.org,
            approver_position_ids=[dept.officer_pos],
            attachment="required",
        )

        allowed = await _remove(as_user, dept.member, request_id, first)
        refused = await _remove(as_user, dept.member, request_id, second)

        assert allowed.status_code == 200, allowed.text
        assert allowed.json()["can_remove_attachment"] is False
        assert refused.status_code == 400
        assert "requires a document" in refused.json()["detail"]
        assert len(_files_on_disk(dept.uploads)) == 1

    async def test_a_file_another_row_names_is_kept(self, as_user, dept, monkeypatch):
        from app.services import member_files

        request_id = await _filed(as_user, dept, count=2)
        first, _ = await _attachment_ids(as_user, dept, request_id)

        async def everything_shared(db, org_id, paths, exclude_rows, areas=None):
            return set(paths)

        monkeypatch.setattr(member_files, "referenced_elsewhere", everything_shared)
        resp = await _remove(as_user, dept.member, request_id, first)

        assert resp.status_code == 200, resp.text
        assert len(resp.json()["attachments"]) == 1
        assert len(_files_on_disk(dept.uploads)) == 2
